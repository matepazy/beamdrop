import { useCallback, useEffect, useRef, useState } from 'react'
import { joinRoom } from 'trystero/nostr'
import { CHUNK_SIZE, parseMessage, totalChunksFor, type BeamMessage, type FileOffer } from '../lib/protocol'
import { inferDeviceType, type DeviceType } from '../lib/device'
import { getRtcConfig } from '../lib/rtc'
import { roomIdFor } from '../lib/codes'
import { decryptBytes, decryptMessage, encryptionKeyFor, encryptBytes, encryptMessage, passwordProofFor } from '../lib/crypto'

export type ConnectionState = 'idle' | 'waiting' | 'peer-found' | 'connecting' | 'connected' | 'disconnected' | 'password-required' | 'not-found' | 'kicked' | 'failed'
export type FeedItem = { id: string; kind: 'text' | 'link' | 'file'; value: string; sender: string; createdAt: number; size?: number; url?: string; received?: boolean; objectUrl?: string }
export type TransferRecord = { id: string; name: string; size: number; mimeType: string; sender: string; createdAt: number; direction: 'sending' | 'receiving'; status: 'offered' | 'active' | 'complete' | 'declined' | 'cancelled' | 'interrupted'; progress: number; speed: number; file?: File }
export type Peer = { id: string; name: string; deviceType: DeviceType }
type Receiver<T> = (callback: (data: T, peerId: string) => void) => void
type Sender<T> = (data: T, peerId?: string) => void | Promise<void>
type RoomLike = { makeAction<T>(name: string): [Sender<T>, Receiver<T>]; onPeerJoin(cb: (peerId: string) => void): void; onPeerLeave(cb: (peerId: string) => void): void; leave(): void }
type IncomingFile = { offer: FileOffer; chunks: Uint8Array[]; bytes: number; startedAt: number; peerId: string }
function uid() { return crypto.randomUUID?.() ?? `${Date.now()}-${crypto.getRandomValues(new Uint32Array(1))[0]}` }

export function useBeam(secret: string | null, password: string, displayName: string, isCreator: boolean) {
  const [state, setState] = useState<ConnectionState>(secret ? 'waiting' : 'idle')
  const [passwordRequired, setPasswordRequired] = useState(false)
  const [peers, setPeers] = useState<Peer[]>([]); const [pendingPeers, setPendingPeers] = useState<Peer[]>([])
  const [feed, setFeed] = useState<FeedItem[]>([]); const [transfers, setTransfers] = useState<TransferRecord[]>([])
  const roomRef = useRef<RoomLike | null>(null); const keyRef = useRef<CryptoKey | null>(null)
  const incomingRef = useRef(new Map<string, IncomingFile>()); const outgoingRef = useRef(new Map<string, File>()); const cancelledRef = useRef(new Set<string>())
  const approvedRef = useRef(new Set<string>()); const knownRef = useRef(new Map<string, Peer>()); const tokensRef = useRef(new Map<string, string>())
  const ownTokenRef = useRef(uid()); const joinedRef = useRef(isCreator)
  const passwordRef = useRef(password)
  const passwordProofRef = useRef('')
  const freeForAllRef = useRef(false)
  const [freeForAll, setFreeForAllState] = useState(false)
  const send = useCallback(async (message: BeamMessage, peerId?: string) => { const room = roomRef.current; const key = keyRef.current; if (!room || !key) return; const [sendControl] = room.makeAction<Uint8Array>('beam-control'); await sendControl(await encryptMessage(key, message), peerId) }, [])

  useEffect(() => {
    passwordRef.current = password
    if (!secret) return
    let cancelled = false
    void Promise.all([encryptionKeyFor(secret), passwordProofFor(secret, password)]).then(([key, proof]) => {
      if (cancelled) return
      keyRef.current = key
      if (isCreator) {
        passwordProofRef.current = proof
        if (joinedRef.current) void send({ type: 'room-settings', passwordProof: proof, freeForAll: freeForAllRef.current })
      }
      // The room key is based on the Beam code alone. A password controls admission,
      // so replacing it never interrupts people already in the Beam.
      if (!isCreator && password && roomRef.current && !joinedRef.current) {
        void send({ type: 'join-request', name: displayName, deviceType: inferDeviceType(), token: ownTokenRef.current, passwordProof: proof })
      }
    })
    return () => { cancelled = true }
  }, [secret, password, displayName, isCreator, send])

  useEffect(() => {
    if (!secret) return
    let stopped = false; let room: RoomLike | null = null; let timer = 0; let accessRetry = 0
    const start = async () => {
      try {
        setPasswordRequired(false); setState('waiting')
        const [rtcConfig, roomId, key, initialProof] = await Promise.all([getRtcConfig(), roomIdFor(secret), encryptionKeyFor(secret), passwordProofFor(secret, passwordRef.current)])
        if (stopped) return
        keyRef.current = key; joinedRef.current = isCreator
        if (isCreator) passwordProofRef.current = initialProof
        room = joinRoom({ appId: 'beamdrop-v1', rtcConfig }, roomId) as unknown as RoomLike; roomRef.current = room
        const [, onControl] = room.makeAction<Uint8Array>('beam-control'); const [sendChunk, onChunk] = room.makeAction<Uint8Array>('beam-chunk')
        const [sendAccess, onAccess] = room.makeAction<{ type: 'probe' } | { type: 'status'; locked: boolean; passwordProof?: string }>('beam-access')
        const transmit = (message: BeamMessage, peerId?: string) => send(message, peerId)
        const hello = (peerId?: string) => void transmit({ type: 'hello', name: displayName, deviceType: inferDeviceType() }, peerId)
        const approve = (peerId: string) => { const token = tokensRef.current.get(peerId); if (!token) return; approvedRef.current.add(peerId); setPendingPeers(current => current.filter(peer => peer.id !== peerId)); void transmit({ type: 'member-approved', peerId, token }); hello(peerId) }
        const announceAccess = (peerId: string) => void sendAccess({ type: 'status', locked: passwordRef.current.length > 0, passwordProof: passwordProofRef.current }, peerId)
        room.onPeerJoin(peerId => {
          setState(current => current === 'waiting' ? 'peer-found' : current)
          if (isCreator || joinedRef.current) {
            // Actions can be created before their data channel is ready. Announce twice
            // so a joiner can reliably discover a lock without knowing its password.
            announceAccess(peerId)
            accessRetry = window.setTimeout(() => { if (!stopped) announceAccess(peerId) }, 300)
          }
          if (!isCreator && !joinedRef.current) {
            void sendAccess({ type: 'probe' }, peerId)
            // A peer can join before the remote action listener is ready. Keep probing
            // until access is confirmed instead of falling through to "not active".
            accessRetry = window.setInterval(() => {
              if (!stopped && !joinedRef.current) void sendAccess({ type: 'probe' }, peerId)
            }, 750)
            void transmit({ type: 'join-request', name: displayName, deviceType: inferDeviceType(), token: ownTokenRef.current, passwordProof: initialProof }, peerId)
          }
        })
        room.onPeerLeave(peerId => { approvedRef.current.delete(peerId); knownRef.current.delete(peerId); tokensRef.current.delete(peerId); setPeers(current => current.filter(peer => peer.id !== peerId)); setPendingPeers(current => current.filter(peer => peer.id !== peerId)); if (joinedRef.current) setState('disconnected') })
        onAccess((message, peerId) => {
          if (message?.type === 'probe' && (isCreator || joinedRef.current)) void sendAccess({ type: 'status', locked: passwordRef.current.length > 0, passwordProof: passwordProofRef.current }, peerId)
          if (message?.type === 'status') {
            clearInterval(accessRetry)
            if (message.passwordProof) passwordProofRef.current = message.passwordProof
            if (message.locked && !passwordRef.current) { clearTimeout(timer); setPasswordRequired(true); setState('password-required') }
          }
        })
        onControl((raw, peerId) => { void (async () => {
          const message = parseMessage(await decryptMessage(keyRef.current ?? key, raw)); if (!message || stopped) return
          if (message.type === 'join-request') { const candidate: Peer = { id: peerId, name: message.name.slice(0, 48), deviceType: message.deviceType }; if (message.passwordProof !== passwordProofRef.current) return; knownRef.current.set(peerId, candidate); tokensRef.current.set(peerId, message.token); if ((isCreator && approvedRef.current.size === 0) || freeForAllRef.current) approve(peerId); else if (joinedRef.current && !approvedRef.current.has(peerId)) setPendingPeers(current => current.some(peer => peer.id === peerId) ? current : [...current, candidate]); return }
          if (message.type === 'room-settings') { passwordProofRef.current = message.passwordProof; freeForAllRef.current = message.freeForAll; setFreeForAllState(message.freeForAll); return }
          if (message.type === 'member-approved') {
            // Approval is broadcast so every member can remove this request. Existing
            // members then introduce themselves to the accepted user individually.
            setPendingPeers(current => current.filter(peer => peer.id !== message.peerId))
            if (!joinedRef.current && message.token === ownTokenRef.current) {
              approvedRef.current.add(peerId)
              joinedRef.current = true
              clearTimeout(timer)
              setState('connected')
              hello(peerId)
            } else if (joinedRef.current && approvedRef.current.has(peerId)) {
              approvedRef.current.add(message.peerId)
              void transmit({ type: 'member-introduction', token: message.token }, message.peerId)
              hello(message.peerId)
            }
            return
          }
          if (message.type === 'member-introduction') {
            if (joinedRef.current && message.token === ownTokenRef.current) {
              approvedRef.current.add(peerId)
              hello(peerId)
            }
            return
          }
          if (message.type === 'member-kicked') { approvedRef.current.delete(message.peerId); setPeers(current => current.filter(peer => peer.id !== message.peerId)); return }
          if (message.type === 'kick-notice') { setState('kicked'); room?.leave(); return }
          if (!approvedRef.current.has(peerId)) return
          if (message.type === 'hello') { const peer: Peer = { id: peerId, name: message.name.slice(0, 48), deviceType: message.deviceType }; knownRef.current.set(peerId, peer); setPeers(current => current.some(p => p.id === peerId) ? current : [...current, peer]); setState('connected'); hello(peerId) }
          if (message.type === 'item') setFeed(current => [{ id: message.item.id, kind: message.item.kind, value: message.item.value, url: message.item.kind === 'link' ? message.item.value : undefined, sender: knownRef.current.get(peerId)?.name ?? 'Connected device', createdAt: message.item.createdAt, received: true }, ...current])
          if (message.type === 'file-offer') { incomingRef.current.set(message.transferId, { offer: message, chunks: [], bytes: 0, startedAt: Date.now(), peerId }); setTransfers(current => [{ id: message.transferId, name: message.name, size: message.size, mimeType: message.mimeType, sender: knownRef.current.get(peerId)?.name ?? 'Connected device', createdAt: Date.now(), direction: 'receiving', status: 'offered', progress: 0, speed: 0 }, ...current]) }
          if (message.type === 'file-accept') { const file = outgoingRef.current.get(message.transferId); if (file) void sendFileChunks(message.transferId, file, peerId, sendChunk, transmit, keyRef.current ?? key, id => cancelledRef.current.has(id), (progress, speed) => setTransfers(current => current.map(item => item.id === message.transferId ? { ...item, status: 'active', progress, speed } : item))) }
          if (message.type === 'file-decline' || message.type === 'file-cancel') setTransfers(current => current.map(item => item.id === message.transferId ? { ...item, status: message.type === 'file-decline' ? 'declined' : 'cancelled' } : item))
          if (message.type === 'file-complete') setTransfers(current => current.map(item => item.id === message.transferId ? { ...item, status: 'complete', progress: 1 } : item))
        })() })
        onChunk((raw, peerId) => { void (async () => { if (!approvedRef.current.has(peerId)) return; const data = await decryptBytes(keyRef.current ?? key, raw); if (!data) return; const [id, indexText, bytes] = decodeChunk(data); const incoming = incomingRef.current.get(id); if (!incoming || incoming.peerId !== peerId || Number(indexText) !== incoming.chunks.length) return; incoming.chunks.push(bytes); incoming.bytes += bytes.byteLength; const elapsed = Math.max((Date.now() - incoming.startedAt) / 1000, .1); setTransfers(current => current.map(item => item.id === id ? { ...item, status: 'active', progress: incoming.bytes / incoming.offer.size, speed: incoming.bytes / elapsed } : item)); if (incoming.bytes >= incoming.offer.size) { const blob = new Blob(incoming.chunks, { type: incoming.offer.mimeType }); const objectUrl = URL.createObjectURL(blob); setTransfers(current => current.map(item => item.id === id ? { ...item, status: 'complete', progress: 1 } : item)); setFeed(current => [{ id, kind: 'file', value: incoming.offer.name, size: incoming.offer.size, sender: knownRef.current.get(peerId)?.name ?? 'Connected device', createdAt: Date.now(), received: true, objectUrl }, ...current]); incomingRef.current.delete(id); void transmit({ type: 'file-complete', transferId: id }, peerId) } })() })
        if (!isCreator) timer = window.setTimeout(() => { if (!joinedRef.current) { room?.leave(); setState('not-found') } }, 8000)
      } catch { setState('failed') }
    }
    void start()
    return () => { stopped = true; clearTimeout(timer); clearInterval(accessRetry); room?.leave(); roomRef.current = null; keyRef.current = null; incomingRef.current.forEach(file => file.chunks.length = 0) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secret, isCreator])

  const sendItem = useCallback((value: string, kind: 'text' | 'link') => { if (!value.trim() || !joinedRef.current) return; const item = { id: uid(), kind, value: value.trim(), createdAt: Date.now() } as const; void send({ type: 'item', item }); setFeed(current => [{ id: item.id, kind, value: item.value, sender: 'You', createdAt: item.createdAt }, ...current]) }, [send])
  const offerFile = useCallback((file: File) => { if (!joinedRef.current) return; const id = uid(); outgoingRef.current.set(id, file); const offer: FileOffer = { type: 'file-offer', transferId: id, name: file.name, size: file.size, mimeType: file.type || 'application/octet-stream', totalChunks: totalChunksFor(file.size) }; void send(offer); setTransfers(current => [{ id, name: file.name, size: file.size, mimeType: offer.mimeType, sender: 'You', createdAt: Date.now(), direction: 'sending', status: 'offered', progress: 0, speed: 0, file }, ...current]) }, [send])
  const replyToOffer = useCallback((id: string, accept: boolean) => { const incoming = incomingRef.current.get(id); if (!incoming) return; void send({ type: accept ? 'file-accept' : 'file-decline', transferId: id }, incoming.peerId); setTransfers(current => current.map(item => item.id === id ? { ...item, status: accept ? 'active' : 'declined' } : item)) }, [send])
  const cancelTransfer = useCallback((id: string) => { cancelledRef.current.add(id); void send({ type: 'file-cancel', transferId: id }); outgoingRef.current.delete(id); incomingRef.current.delete(id); setTransfers(current => current.map(item => item.id === id ? { ...item, status: 'cancelled' } : item)) }, [send])
  const admitPeer = useCallback((peerId: string) => { const token = tokensRef.current.get(peerId); if (!token) return; approvedRef.current.add(peerId); setPendingPeers(current => current.filter(peer => peer.id !== peerId)); void send({ type: 'member-approved', peerId, token }) }, [send])
  const kickPeer = useCallback((peerId: string) => { approvedRef.current.delete(peerId); setPeers(current => current.filter(peer => peer.id !== peerId)); void send({ type: 'member-kicked', peerId }); void send({ type: 'kick-notice' }, peerId) }, [send])
  const setFreeForAll = useCallback((enabled: boolean) => { if (!isCreator) return; freeForAllRef.current = enabled; setFreeForAllState(enabled); void send({ type: 'room-settings', passwordProof: passwordProofRef.current, freeForAll: enabled }) }, [isCreator, send])
  return { state, passwordRequired, peers, pendingPeers, feed, transfers, sendItem, offerFile, replyToOffer, cancelTransfer, admitPeer, kickPeer, freeForAll, setFreeForAll }
}
async function sendFileChunks(id: string, file: File, peerId: string, sendChunk: Sender<Uint8Array>, sendControl: (message: BeamMessage, peerId?: string) => Promise<void>, key: CryptoKey, isCancelled: (id: string) => boolean, report: (progress: number, speed: number) => void) { const started = Date.now(); for (let offset = 0, index = 0; offset < file.size; offset += CHUNK_SIZE, index++) { if (isCancelled(id)) return; const body = new Uint8Array(await file.slice(offset, offset + CHUNK_SIZE).arrayBuffer()); await sendChunk(await encryptBytes(key, encodeChunk(id, index, body)), peerId); const sent = Math.min(offset + body.byteLength, file.size); report(sent / file.size, sent / Math.max((Date.now() - started) / 1000, .1)); if (Date.now() - started > 16) await new Promise(resolve => setTimeout(resolve, 0)) }; await sendControl({ type: 'file-complete', transferId: id }, peerId); report(1, file.size / Math.max((Date.now() - started) / 1000, .1)) }
function encodeChunk(id: string, index: number, body: Uint8Array) { const header = new TextEncoder().encode(`${id}:${index}:`); const result = new Uint8Array(header.length + body.length); result.set(header); result.set(body, header.length); return result }
function decodeChunk(data: Uint8Array): [string, string, Uint8Array] { const first = data.indexOf(58); const second = data.indexOf(58, first + 1); return [new TextDecoder().decode(data.slice(0, first)), new TextDecoder().decode(data.slice(first + 1, second)), data.slice(second + 1)] }
