import { useCallback, useEffect, useRef, useState } from 'react'
import { joinRoom } from 'trystero/torrent'
import { CHUNK_SIZE, parseMessage, totalChunksFor, type BeamMessage, type FileOffer } from '../lib/protocol'
import { inferDeviceType, type DeviceType } from '../lib/device'
import { getRtcConfig } from '../lib/rtc'
import { roomIdFor } from '../lib/codes'

export type ConnectionState = 'idle' | 'waiting' | 'peer-found' | 'connecting' | 'connected' | 'disconnected' | 'failed'
export type FeedItem = { id: string; kind: 'text' | 'link' | 'file'; value: string; sender: string; size?: number; url?: string; received?: boolean; objectUrl?: string }
export type TransferRecord = { id: string; name: string; size: number; mimeType: string; sender: string; direction: 'sending' | 'receiving'; status: 'offered' | 'active' | 'complete' | 'declined' | 'cancelled' | 'interrupted'; progress: number; speed: number; file?: File }
export type Peer = { id: string; name: string; deviceType: DeviceType }

type Receiver<T> = (callback: (data: T, peerId: string) => void) => void
type Sender<T> = (data: T, peerId?: string) => void | Promise<void>
type RoomLike = { makeAction<T>(name: string): [Sender<T>, Receiver<T>]; onPeerJoin(cb: (peerId: string) => void): void; onPeerLeave(cb: (peerId: string) => void): void; leave(): void }
type IncomingFile = { offer: FileOffer; chunks: Uint8Array[]; bytes: number; startedAt: number; peerId: string }

function uid() { return crypto.randomUUID?.() ?? `${Date.now()}-${crypto.getRandomValues(new Uint32Array(1))[0]}` }
function debug(event: string, context?: Record<string, unknown>) { if (import.meta.env.DEV) console.info(`[beam] ${event}`, context ? Object.keys(context) : '') }

export function useBeam(secret: string | null, displayName: string) {
  const [state, setState] = useState<ConnectionState>(secret ? 'waiting' : 'idle')
  const [peers, setPeers] = useState<Peer[]>([])
  const [feed, setFeed] = useState<FeedItem[]>([])
  const [transfers, setTransfers] = useState<TransferRecord[]>([])
  const roomRef = useRef<RoomLike | null>(null)
  const incomingRef = useRef(new Map<string, IncomingFile>())
  const outgoingRef = useRef(new Map<string, File>())
  const cancelledRef = useRef(new Set<string>())

  useEffect(() => {
    if (!secret) return
    let stopped = false
    let room: RoomLike | null = null
    const start = async () => {
      try {
        const [rtcConfig, roomId] = await Promise.all([getRtcConfig(), roomIdFor(secret)])
        if (stopped) return
        room = joinRoom({ appId: 'beamdrop-v1', rtcConfig }, roomId) as unknown as RoomLike
        roomRef.current = room
        const [sendControl, onControl] = room.makeAction<BeamMessage>('beam-control')
        const [sendChunk, onChunk] = room.makeAction<Uint8Array>('beam-chunk')
        const sendHello = (peerId?: string) => void sendControl({ type: 'hello', name: displayName, deviceType: inferDeviceType() }, peerId)
        room.onPeerJoin(peerId => { debug('peer joined'); setState('peer-found'); sendHello(peerId) })
        room.onPeerLeave(peerId => { setPeers(current => current.filter(peer => peer.id !== peerId)); setState('disconnected') })
        onControl((raw, peerId) => {
          const message = parseMessage(raw)
          if (!message) return
          if (message.type === 'hello') {
            setPeers(current => current.some(peer => peer.id === peerId) ? current : [...current, { id: peerId, name: message.name.slice(0, 48), deviceType: message.deviceType }])
            setState('connected'); sendHello(peerId)
          }
          if (message.type === 'item') {
            const peer = peers.find(candidate => candidate.id === peerId)
            setFeed(current => [{ id: message.item.id, kind: message.item.kind, value: message.item.value, url: message.item.kind === 'link' ? message.item.value : undefined, sender: peer?.name ?? 'Connected device', received: true }, ...current])
          }
          if (message.type === 'file-offer') {
            incomingRef.current.set(message.transferId, { offer: message, chunks: [], bytes: 0, startedAt: Date.now(), peerId })
            setTransfers(current => [{ id: message.transferId, name: message.name, size: message.size, mimeType: message.mimeType, sender: peers.find(peer => peer.id === peerId)?.name ?? 'Connected device', direction: 'receiving', status: 'offered', progress: 0, speed: 0 }, ...current])
          }
          if (message.type === 'file-accept') {
            const file = outgoingRef.current.get(message.transferId)
            if (file) void sendFileChunks(message.transferId, file, peerId, sendChunk, sendControl, id => cancelledRef.current.has(id), (progress, speed) => setTransfers(current => current.map(item => item.id === message.transferId ? { ...item, status: 'active', progress, speed } : item)))
          }
          if (message.type === 'file-decline' || message.type === 'file-cancel') setTransfers(current => current.map(item => item.id === message.transferId ? { ...item, status: message.type === 'file-decline' ? 'declined' : 'cancelled' } : item))
          if (message.type === 'file-complete') setTransfers(current => current.map(item => item.id === message.transferId ? { ...item, status: 'complete', progress: 1 } : item))
        })
        onChunk((data, peerId) => {
          const [id, indexText, bytes] = decodeChunk(data)
          const incoming = incomingRef.current.get(id)
          if (!incoming || incoming.peerId !== peerId || Number(indexText) !== incoming.chunks.length) return
          incoming.chunks.push(bytes); incoming.bytes += bytes.byteLength
          const elapsed = Math.max((Date.now() - incoming.startedAt) / 1000, 0.1)
          setTransfers(current => current.map(item => item.id === id ? { ...item, status: 'active', progress: incoming.bytes / incoming.offer.size, speed: incoming.bytes / elapsed } : item))
          if (incoming.bytes >= incoming.offer.size) {
            const blob = new Blob(incoming.chunks, { type: incoming.offer.mimeType })
            const objectUrl = URL.createObjectURL(blob)
            setTransfers(current => current.map(item => item.id === id ? { ...item, status: 'complete', progress: 1 } : item))
            setFeed(current => [{ id, kind: 'file', value: incoming.offer.name, size: incoming.offer.size, sender: peers.find(peer => peer.id === peerId)?.name ?? 'Connected device', received: true, objectUrl }, ...current])
            incomingRef.current.delete(id); void sendControl({ type: 'file-complete', transferId: id }, peerId)
          }
        })
      } catch { setState('failed') }
    }
    void start()
    return () => { stopped = true; room?.leave(); roomRef.current = null; incomingRef.current.forEach(file => file.chunks.length = 0) }
  // Joining must only change when the secret changes; the current display name is sent on peer events.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secret])

  const sendItem = useCallback((value: string, kind: 'text' | 'link') => {
    const room = roomRef.current; if (!room || !value.trim()) return
    const [send] = room.makeAction<BeamMessage>('beam-control')
    const item = { id: uid(), kind, value: value.trim(), createdAt: Date.now() } as const
    void send({ type: 'item', item })
    setFeed(current => [{ id: item.id, kind, value: item.value, sender: 'You' }, ...current])
  }, [])
  const offerFile = useCallback((file: File) => {
    const room = roomRef.current; if (!room) return
    const [send] = room.makeAction<BeamMessage>('beam-control'); const id = uid(); outgoingRef.current.set(id, file)
    const offer: FileOffer = { type: 'file-offer', transferId: id, name: file.name, size: file.size, mimeType: file.type || 'application/octet-stream', totalChunks: totalChunksFor(file.size) }
    void send(offer); setTransfers(current => [{ id, name: file.name, size: file.size, mimeType: offer.mimeType, sender: 'You', direction: 'sending', status: 'offered', progress: 0, speed: 0, file }, ...current])
  }, [])
  const replyToOffer = useCallback((id: string, accept: boolean) => { const room = roomRef.current; if (!room) return; const [send] = room.makeAction<BeamMessage>('beam-control'); const incoming = incomingRef.current.get(id); if (!incoming) return; void send({ type: accept ? 'file-accept' : 'file-decline', transferId: id }, incoming.peerId); setTransfers(current => current.map(item => item.id === id ? { ...item, status: accept ? 'active' : 'declined' } : item)) }, [])
  const cancelTransfer = useCallback((id: string) => { const room = roomRef.current; if (!room) return; const [send] = room.makeAction<BeamMessage>('beam-control'); cancelledRef.current.add(id); void send({ type: 'file-cancel', transferId: id }); outgoingRef.current.delete(id); incomingRef.current.delete(id); setTransfers(current => current.map(item => item.id === id ? { ...item, status: 'cancelled' } : item)) }, [])
  return { state, peers, feed, transfers, sendItem, offerFile, replyToOffer, cancelTransfer }
}

async function sendFileChunks(id: string, file: File, peerId: string, sendChunk: Sender<Uint8Array>, sendControl: Sender<BeamMessage>, isCancelled: (id: string) => boolean, report: (progress: number, speed: number) => void) {
  const started = Date.now()
  for (let offset = 0, index = 0; offset < file.size; offset += CHUNK_SIZE, index++) {
    if (isCancelled(id)) return
    const body = new Uint8Array(await file.slice(offset, offset + CHUNK_SIZE).arrayBuffer())
    await sendChunk(encodeChunk(id, index, body), peerId)
    const sent = Math.min(offset + body.byteLength, file.size)
    report(sent / file.size, sent / Math.max((Date.now() - started) / 1000, 0.1))
    if (Date.now() - started > 16) await new Promise(resolve => setTimeout(resolve, 0))
  }
  await sendControl({ type: 'file-complete', transferId: id }, peerId)
  report(1, file.size / Math.max((Date.now() - started) / 1000, 0.1))
}
function encodeChunk(id: string, index: number, body: Uint8Array) { const header = new TextEncoder().encode(`${id}:${index}:`); const result = new Uint8Array(header.length + body.length); result.set(header); result.set(body, header.length); return result }
function decodeChunk(data: Uint8Array): [string, string, Uint8Array] { const first = data.indexOf(58); const second = data.indexOf(58, first + 1); return [new TextDecoder().decode(data.slice(0, first)), new TextDecoder().decode(data.slice(first + 1, second)), data.slice(second + 1)] }
