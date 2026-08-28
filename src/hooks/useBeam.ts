import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { joinRoom } from 'trystero/nostr'
import { deriveRoomMaterial } from '../lib/crypto'
import { inferDeviceType, type DeviceType } from '../lib/device'
import { CHUNK_SIZE, MAX_ACTIVE_TRANSFERS, MAX_FILE_SIZE, decodeChunk, encodeChunk, parseMessage, totalChunksFor, type BeamMessage, type FileOffer } from '../lib/protocol'
import { getRtcConfig } from '../lib/rtc'
import { getRoomDiagnostics, type RtcDiagnostics } from '../lib/rtcDiagnostics'
import { createTransferMeter, PREPARED_CHUNK_COUNT, shouldReportProgress } from '../lib/transfer'

export type ConnectionState = 'idle' | 'waiting' | 'peer-found' | 'connecting' | 'connected' | 'disconnected' | 'password-required' | 'not-found' | 'kicked' | 'failed'
export type FeedItem = { id: string; kind: 'text' | 'link' | 'file'; value: string; sender: string; createdAt: number; size?: number; url?: string; received?: boolean; objectUrl?: string }
export type TransferRecord = { id: string; name: string; size: number; mimeType: string; sender: string; createdAt: number; direction: 'sending' | 'receiving'; status: 'offered' | 'active' | 'complete' | 'declined' | 'cancelled' | 'interrupted'; progress: number; speed: number; averageSpeed?: number; peakSpeed?: number; elapsedMs?: number; file?: File }
export type Peer = { id: string; name: string; deviceType: DeviceType }
type Sender<T> = (data: T, peerId?: string) => Promise<void>
type RoomLike = { makeAction<T>(name: string): { send(data: T, options?: { target?: string }): Promise<void>; onMessage: ((data: T, context: { peerId: string }) => void) | null }; onPeerJoin: ((peerId: string) => void) | null; onPeerLeave: ((peerId: string) => void) | null; getPeers(): Record<string, RTCPeerConnection>; leave(): Promise<void> }
type Incoming = { offer: FileOffer; chunks?: Uint8Array[]; bytes: number; peerId: string; accepted: boolean; meter?: ReturnType<typeof createTransferMeter>; lastReportedAt?: number }
type AccessMessage = { type: 'probe' } | { type: 'status'; locked: boolean } | { type: 'authenticate' } | { type: 'admitted' }
const CONTROL = 'beam-control-v2', CHUNK = 'beam-chunk-v2', ACCESS = 'beam-access-v2', NOT_FOUND_TIMEOUT = 8_000
const uid = () => crypto.randomUUID?.() ?? `${Date.now()}-${crypto.getRandomValues(new Uint32Array(1))[0]}`

export function useBeam(secret: string | null, _password: string, displayName: string, isCreator: boolean) {
  const [state, setState] = useState<ConnectionState>(secret ? 'waiting' : 'idle')
  const [passwordRequired, setPasswordRequired] = useState(false)
  const [peers, setPeers] = useState<Peer[]>([])
  const [pendingPeers] = useState<Peer[]>([])
  const [feed, setFeed] = useState<FeedItem[]>([])
  const [transfers, setTransfers] = useState<TransferRecord[]>([])
  const [freeForAll, setFreeForAll] = useState(false)
  const roomRef = useRef<RoomLike | null>(null), sendRef = useRef<Sender<BeamMessage> | null>(null)
  const incoming = useRef(new Map<string, Incoming>()), outgoing = useRef(new Map<string, File>()), aborters = useRef(new Map<string, AbortController>()), known = useRef(new Map<string, Peer>()), nameRef = useRef(displayName)
  useEffect(() => { nameRef.current = displayName }, [displayName])
  const updateTransfer = (id: string, update: Partial<TransferRecord>) => setTransfers(current => current.map(item => item.id === id ? { ...item, ...update } : item))
  const send = useCallback(async (message: BeamMessage, peerId?: string) => { await sendRef.current?.(message, peerId) }, [])

  useEffect(() => {
    if (!secret) { setState('idle'); return }
    let stopped = false; let room: RoomLike | null = null; let notFound: number | undefined; let foundTransportPeer = false
    const removePeer = (peerId: string) => { known.current.delete(peerId); setPeers(current => current.filter(peer => peer.id !== peerId)) }
    const addPeer = (peer: Peer) => setPeers(current => current.some(existing => existing.id === peer.id) ? current : [...current, peer])
    const peerName = (peerId: string) => known.current.get(peerId)?.name ?? 'Connected device'
    const start = async () => {
      try {
        setState('waiting'); setPasswordRequired(false)
        const [rtcConfig, material] = await Promise.all([getRtcConfig(), deriveRoomMaterial(secret)])
        if (stopped) return
        room = joinRoom({ appId: 'beamdrop-v2', rtcConfig, password: material.signalingKey }, material.roomId) as unknown as RoomLike
        roomRef.current = room
        const approved = new Set<string>()
        const control = room.makeAction<BeamMessage>(CONTROL), chunks = room.makeAction<Uint8Array>(CHUNK), access = room.makeAction<AccessMessage>(ACCESS)
        sendRef.current = async (message, peerId) => { if (peerId) return control.send(message, { target: peerId }); await Promise.all([...approved].map(id => control.send(message, { target: id }))) }
        const admit = (peerId: string) => { approved.add(peerId); void access.send({ type: 'admitted' }, { target: peerId }); void control.send({ v: 2, type: 'hello', name: nameRef.current, deviceType: inferDeviceType() }, { target: peerId }) }
        room.onPeerJoin = peerId => { if (stopped) return; foundTransportPeer = true; setState('peer-found'); if (isCreator) void access.send({ type: 'status', locked: false }, { target: peerId }); else void access.send({ type: 'probe' }, { target: peerId }) }
        room.onPeerLeave = peerId => {
          removePeer(peerId)
          if (!stopped) setState('disconnected')
        }
        access.onMessage = (message, { peerId }) => {
          if (stopped || !message || typeof message !== 'object') return
          if (isCreator && message.type === 'probe') { void access.send({ type: 'status', locked: false }, { target: peerId }); return }
          if (!isCreator && message.type === 'status') { void access.send({ type: 'authenticate' }, { target: peerId }); return }
          if (isCreator && message.type === 'authenticate') { admit(peerId); return }
          if (!isCreator && message.type === 'admitted') { approved.add(peerId); setPasswordRequired(false); setState('connected'); void control.send({ v: 2, type: 'hello', name: nameRef.current, deviceType: inferDeviceType() }, { target: peerId }) }
        }
        control.onMessage = (raw, { peerId }) => {
          const message = parseMessage(raw); if (!message || stopped) return
          if (!approved.has(peerId)) return
          if (message.type === 'kick-notice') { if (!isCreator) { setState('kicked'); void room?.leave() }; return }
          if (message.type === 'hello') { const peer = { id: peerId, name: message.name, deviceType: message.deviceType }; known.current.set(peerId, peer); addPeer(peer); setState('connected'); return }
          if (message.type === 'item') { setFeed(current => [{ id: message.item.id, kind: message.item.kind, value: message.item.value, url: message.item.kind === 'link' ? message.item.value : undefined, sender: peerName(peerId), createdAt: message.item.createdAt, received: true }, ...current]); return }
          if (message.type === 'file-offer') { if (incoming.current.size >= MAX_ACTIVE_TRANSFERS || incoming.current.has(message.transferId)) return; incoming.current.set(message.transferId, { offer: message, bytes: 0, peerId, accepted: false }); setTransfers(current => [{ id: message.transferId, name: message.name, size: message.size, mimeType: message.mimeType, sender: peerName(peerId), createdAt: Date.now(), direction: 'receiving', status: 'offered', progress: 0, speed: 0 }, ...current]); return }
          if (message.type === 'file-accept') { const file = outgoing.current.get(message.transferId); if (!file) return; const controller = new AbortController(); aborters.current.set(message.transferId, controller); updateTransfer(message.transferId, { status: 'active' }); void sendFile({ id: message.transferId, file, peerId, sendChunk: (value, target) => chunks.send(value, { target }), sendControl: send, signal: controller.signal, report: (progress, speed, metrics) => updateTransfer(message.transferId, { status: 'active', progress, speed, ...metrics }) }).catch(() => updateTransfer(message.transferId, { status: 'interrupted' })).finally(() => aborters.current.delete(message.transferId)); return }
          if (message.type === 'file-decline' || message.type === 'file-cancel') { updateTransfer(message.transferId, { status: message.type === 'file-decline' ? 'declined' : 'cancelled' }); incoming.current.delete(message.transferId); return }
          if (message.type === 'file-complete') { const transfer = incoming.current.get(message.transferId); if (transfer?.accepted && transfer.bytes === transfer.offer.size) { const objectUrl = URL.createObjectURL(new Blob(transfer.chunks ?? [], { type: transfer.offer.mimeType })); updateTransfer(message.transferId, { status: 'complete', progress: 1 }); setFeed(current => [{ id: message.transferId, kind: 'file', value: transfer.offer.name, size: transfer.offer.size, sender: peerName(peerId), createdAt: Date.now(), received: true, objectUrl }, ...current]); incoming.current.delete(message.transferId) } else { outgoing.current.delete(message.transferId); updateTransfer(message.transferId, { status: 'complete', progress: 1 }) } }
        }
        chunks.onMessage = (raw, { peerId }) => {
          const frame = decodeChunk(raw); if (!frame) return; const transfer = incoming.current.get(frame.transferId)
          // Offers cannot allocate or receive: only an explicit local accept opens the bounded buffer.
          if (!transfer || !transfer.accepted || !transfer.chunks || transfer.peerId !== peerId || frame.index !== transfer.chunks.length || transfer.bytes + frame.payload.byteLength > transfer.offer.size) return
          transfer.chunks.push(frame.payload); transfer.bytes += frame.payload.byteLength; const measurement = (transfer.meter ??= createTransferMeter())(transfer.bytes); const now = performance.now()
          if (shouldReportProgress(transfer.lastReportedAt ?? 0, now) || transfer.bytes === transfer.offer.size) { transfer.lastReportedAt = now; updateTransfer(frame.transferId, { status: 'active', progress: transfer.offer.size ? transfer.bytes / transfer.offer.size : 1, speed: measurement.speed, averageSpeed: measurement.averageSpeed, peakSpeed: measurement.peakSpeed, elapsedMs: measurement.elapsedMs }) }
          if (transfer.bytes !== transfer.offer.size) return
          const objectUrl = URL.createObjectURL(new Blob(transfer.chunks, { type: transfer.offer.mimeType })); updateTransfer(frame.transferId, { status: 'complete', progress: 1 }); setFeed(current => [{ id: frame.transferId, kind: 'file', value: transfer.offer.name, size: transfer.offer.size, sender: peerName(peerId), createdAt: Date.now(), received: true, objectUrl }, ...current]); incoming.current.delete(frame.transferId); void send({ v: 2, type: 'file-complete', transferId: frame.transferId }, peerId)
        }
        // A locked peer intentionally receives no normal hello yet, so "known"
        // remains empty. Discovery is based on transport presence instead.
        if (!isCreator) notFound = window.setTimeout(() => { if (!stopped && !foundTransportPeer) { void room?.leave(); setState('not-found') } }, NOT_FOUND_TIMEOUT)
      } catch { if (!stopped) setState('failed') }
    }; void start()
    return () => { stopped = true; if (notFound) clearTimeout(notFound); aborters.current.forEach(controller => controller.abort()); aborters.current.clear(); incoming.current.clear(); sendRef.current = null; roomRef.current = null; void room?.leave() }
  }, [secret, isCreator, send])
  const sendItem = useCallback((value: string, kind: 'text' | 'link') => { const item = { id: uid(), kind, value: value.trim(), createdAt: Date.now() } as const; if (!item.value) return; void send({ v: 2, type: 'item', item }); setFeed(current => [{ id: item.id, kind, value: item.value, sender: 'You', createdAt: item.createdAt }, ...current]) }, [send])
  const offerFile = useCallback((file: File) => { if (!Number.isFinite(file.size) || file.size < 0 || file.size > MAX_FILE_SIZE) return; const id = uid(); const offer: FileOffer = { v: 2, type: 'file-offer', transferId: id, name: file.name.slice(0, 255), size: file.size, mimeType: (file.type || 'application/octet-stream').slice(0, 127), totalChunks: totalChunksFor(file.size) }; outgoing.current.set(id, file); void send(offer); setTransfers(current => [{ id, name: offer.name, size: file.size, mimeType: offer.mimeType, sender: 'You', createdAt: Date.now(), direction: 'sending', status: 'offered', progress: 0, speed: 0, file }, ...current]) }, [send])
  const replyToOffer = useCallback((id: string, accept: boolean) => { const transfer = incoming.current.get(id); if (!transfer || transfer.accepted) return; transfer.accepted = accept; if (accept) transfer.chunks = []; else incoming.current.delete(id); void send({ v: 2, type: accept ? 'file-accept' : 'file-decline', transferId: id }, transfer.peerId); updateTransfer(id, { status: accept ? 'active' : 'declined' }) }, [send])
  const cancelTransfer = useCallback((id: string) => { aborters.current.get(id)?.abort(); outgoing.current.delete(id); incoming.current.delete(id); void send({ v: 2, type: 'file-cancel', transferId: id }); updateTransfer(id, { status: 'cancelled' }) }, [send])
  const kickPeer = useCallback((peerId: string) => { if (!isCreator) return; void send({ v: 2, type: 'kick-notice' }, peerId); removePeerLocal(peerId, known, setPeers) }, [isCreator, send])
  return { state, passwordRequired, peers, pendingPeers, feed, transfers, sendItem, offerFile, replyToOffer, cancelTransfer, admitPeer: (_peerId: string) => {}, kickPeer, freeForAll, setFreeForAll: (enabled: boolean) => { if (isCreator) setFreeForAll(enabled) }, getDiagnostics: async (): Promise<RtcDiagnostics[]> => roomRef.current ? getRoomDiagnostics(roomRef.current.getPeers()) : [] }
}
function removePeerLocal(peerId: string, known: MutableRefObject<Map<string, Peer>>, setPeers: Dispatch<SetStateAction<Peer[]>>) { known.current.delete(peerId); setPeers(current => current.filter(peer => peer.id !== peerId)) }
async function sendFile({ id, file, peerId, sendChunk, sendControl, signal, report }: { id: string; file: File; peerId: string; sendChunk: (data: Uint8Array, peerId: string) => Promise<void>; sendControl: Sender<BeamMessage>; signal: AbortSignal; report: (progress: number, speed: number, metrics: { averageSpeed: number; peakSpeed: number; elapsedMs: number }) => void }) {
  let offset = 0, index = 0, sent = 0, last = 0; const meter = createTransferMeter(); const prepared: Promise<{ body: Uint8Array; index: number } | null>[] = []
  const prepare = async () => { if (signal.aborted || offset >= file.size) return null; const start = offset, chunkIndex = index; offset += CHUNK_SIZE; index += 1; return { body: new Uint8Array(await file.slice(start, Math.min(start + CHUNK_SIZE, file.size)).arrayBuffer()), index: chunkIndex } }
  const fill = () => { while (prepared.length < PREPARED_CHUNK_COUNT && offset < file.size) prepared.push(prepare()) }; fill()
  try { while (prepared.length) { const item = await prepared.shift(); if (!item || signal.aborted) return; await sendChunk(encodeChunk(id, item.index, item.body), peerId); sent += item.body.byteLength; fill(); const measurement = meter(sent), now = performance.now(); if (shouldReportProgress(last, now) || sent === file.size) { last = now; report(file.size ? sent / file.size : 1, measurement.speed, measurement) } } if (!signal.aborted) await sendControl({ v: 2, type: 'file-complete', transferId: id }, peerId) } finally { await Promise.allSettled(prepared) }
}
