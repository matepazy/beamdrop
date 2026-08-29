import { useCallback, useEffect, useRef, useState } from 'react'
import { joinRoom } from 'trystero/nostr'
import { deriveRoomMaterial } from '../lib/crypto'
import { authenticatePeer } from '../lib/peerAuth'
import { inferDeviceType, type DeviceType } from '../lib/device'
import { CHUNK_SIZE, MAX_ACTIVE_TRANSFERS, MAX_FILE_SIZE, decodeChunk, encodeChunk, parseMessage, totalChunksFor, type BeamMessage, type FileOffer } from '../lib/protocol'
import { getRtcConfig } from '../lib/rtc'
import { getRoomDiagnostics, type RtcDiagnostics } from '../lib/rtcDiagnostics'
import { areAllRecipientsTerminal, createTransferMeter, isRecipientTerminal, PREPARED_CHUNK_COUNT, shouldReportProgress, type OutgoingTransfer } from '../lib/transfer'

export type ConnectionState = 'idle' | 'waiting' | 'peer-found' | 'connecting' | 'connected' | 'disconnected' | 'password-required' | 'not-found' | 'kicked' | 'verification-failed' | 'failed'
export type FeedItem = { id: string; kind: 'text' | 'link' | 'file'; value: string; sender: string; createdAt: number; size?: number; url?: string; received?: boolean; objectUrl?: string }
export type TransferRecord = { id: string; transferId: string; peerId?: string; name: string; size: number; mimeType: string; sender: string; createdAt: number; direction: 'sending' | 'receiving'; status: 'offered' | 'active' | 'complete' | 'declined' | 'cancelled' | 'interrupted'; progress: number; speed: number; averageSpeed?: number; peakSpeed?: number; elapsedMs?: number; file?: File }
export type Peer = { id: string; name: string; deviceType: DeviceType }
type PeerSession = { peerId: string; displayName: string; role: 'creator' | 'member'; status: 'pending' | 'authenticated' | 'connected' | 'disconnected' | 'kicked'; deviceType: DeviceType }
type Sender<T> = (data: T, peerId?: string) => Promise<void>
type RoomLike = { makeAction<T>(name: string): { send(data: T, options?: { target?: string }): Promise<void>; onMessage: ((data: T, context: { peerId: string }) => void) | null }; onPeerJoin: ((peerId: string) => void) | null; onPeerLeave: ((peerId: string) => void) | null; getPeers(): Record<string, RTCPeerConnection>; leave(): Promise<void> }
type Incoming = { recordId: string; offer: FileOffer; chunks?: Uint8Array[]; bytes: number; peerId: string; accepted: boolean; meter?: ReturnType<typeof createTransferMeter>; lastReportedAt?: number }
type AccessMessage =
  | { type: 'join-request'; name: string; deviceType: DeviceType; token: string }
  | { type: 'member-approved'; peerId: string; token: string }
type TypingMessage = { active: boolean }
const CONTROL = 'beam-control-v2', CHUNK = 'beam-chunk-v2', ACCESS = 'beam-access-v2', TYPING = 'beam-typing-v1', NOT_FOUND_TIMEOUT = 8_000, TYPING_TIMEOUT = 3_500, TYPING_REFRESH_INTERVAL = 1_500
const uid = () => crypto.randomUUID?.().replaceAll('-', '_') ?? `${Date.now()}_${crypto.getRandomValues(new Uint32Array(1))[0]}`
const incomingKey = (peerId: string, transferId: string) => `${peerId}:${transferId}`
function outgoingView(transfer: OutgoingTransfer): Pick<TransferRecord, 'status' | 'progress'> {
  const recipients = [...transfer.recipients.values()]
  const complete = recipients.length > 0 && recipients.every(recipient => recipient.status === 'completed')
  const terminal = recipients.length > 0 && recipients.every(recipient => isRecipientTerminal(recipient.status))
  const status: TransferRecord['status'] = complete ? 'complete' : terminal ? recipients.some(recipient => recipient.status === 'failed') ? 'interrupted' : recipients.some(recipient => recipient.status === 'cancelled') ? 'cancelled' : 'declined' : recipients.some(recipient => recipient.status === 'transferring' || recipient.status === 'accepted') ? 'active' : 'offered'
  const bytesSent = recipients.reduce((sum, recipient) => sum + recipient.bytesSent, 0)
  return { status, progress: transfer.file.size && recipients.length ? bytesSent / (transfer.file.size * recipients.length) : complete ? 1 : 0 }
}

export function useBeam(secret: string | null, _password: string, displayName: string, isCreator: boolean) {
  const [state, setState] = useState<ConnectionState>(secret ? 'waiting' : 'idle')
  const [passwordRequired, setPasswordRequired] = useState(false)
  const [peers, setPeers] = useState<Peer[]>([])
  const [pendingPeers, setPendingPeers] = useState<Peer[]>([])
  const [feed, setFeed] = useState<FeedItem[]>([])
  const [transfers, setTransfers] = useState<TransferRecord[]>([])
  const [typingPeerIds, setTypingPeerIds] = useState<string[]>([])
  const [freeForAll, setFreeForAllState] = useState(false)
  const [connectionAttempt, setConnectionAttempt] = useState(0)
  const roomRef = useRef<RoomLike | null>(null), sendRef = useRef<Sender<BeamMessage> | null>(null)
  const incoming = useRef(new Map<string, Incoming>()), outgoing = useRef(new Map<string, OutgoingTransfer>()), sessions = useRef(new Map<string, PeerSession>()), nameRef = useRef(displayName), joinTokens = useRef(new Map<string, string>()), ownJoinToken = useRef(uid()), joined = useRef(isCreator), freeForAllRef = useRef(false), admitPeerRef = useRef<(peerId: string) => void>(() => {}), invalidPeers = useRef(new Map<string, number>()), typingTimers = useRef(new Map<string, number>()), typingActive = useRef(false), typingLastSentAt = useRef(0), sendTypingRef = useRef<(active: boolean) => void>(() => {})
  useEffect(() => { nameRef.current = displayName }, [displayName])
  const updateTransfer = useCallback((id: string, update: Partial<TransferRecord>) => setTransfers(current => current.map(item => item.id === id ? { ...item, ...update } : item)), [])
  const send = useCallback(async (message: BeamMessage, peerId?: string) => { await sendRef.current?.(message, peerId) }, [])
  const setTyping = useCallback((active: boolean) => sendTypingRef.current(active), [])
  const retryConnection = useCallback(() => setConnectionAttempt(current => current + 1), [])

  useEffect(() => {
    if (!secret) return
    addEventListener('online', retryConnection)
    return () => removeEventListener('online', retryConnection)
  }, [secret, retryConnection])

  useEffect(() => {
    if (!secret) { setState('idle'); return }
    let stopped = false; let room: RoomLike | null = null; let notFound: number | undefined; let recoveryTimer: number | undefined; let foundTransportPeer = false; let hadConnectedPeer = false
    joined.current = isCreator; ownJoinToken.current = uid(); freeForAllRef.current = false; setFreeForAllState(false); setPendingPeers([]); setTypingPeerIds([])
    const syncPeers = () => setPeers([...sessions.current.values()].filter(session => session.status === 'connected').map(session => ({ id: session.peerId, name: session.displayName, deviceType: session.deviceType })))
    const rejectInvalid = (peerId: string) => { const count = (invalidPeers.current.get(peerId) ?? 0) + 1; invalidPeers.current.set(peerId, count); return count >= 8 }
    const isBlocked = (peerId: string) => (invalidPeers.current.get(peerId) ?? 0) >= 8
    const updateConnectionState = () => { if (!stopped) setState([...sessions.current.values()].some(session => session.status === 'connected') ? 'connected' : 'waiting') }
    const recover = () => {
      if (stopped || recoveryTimer) return
      setState('disconnected')
      recoveryTimer = window.setTimeout(() => {
        if (!stopped) setConnectionAttempt(current => current + 1)
      }, 1_500)
    }
    const peerName = (peerId: string) => sessions.current.get(peerId)?.displayName ?? 'Connected device'
    const updateOutgoingRecord = (transfer: OutgoingTransfer, metrics?: { speed: number; averageSpeed: number; peakSpeed: number; elapsedMs: number }) => {
      updateTransfer(transfer.id, { ...outgoingView(transfer), ...metrics })
      if (areAllRecipientsTerminal(transfer)) { outgoing.current.delete(transfer.id); updateTransfer(transfer.id, { file: undefined }) }
    }
    const endOutgoingForPeer = (peerId: string, status: 'failed' | 'cancelled') => { for (const transfer of [...outgoing.current.values()]) { const recipient = transfer.recipients.get(peerId); if (!recipient || isRecipientTerminal(recipient.status)) continue; recipient.abortController?.abort(); recipient.abortController = undefined; recipient.status = status; updateOutgoingRecord(transfer) } }
    const start = async () => {
      try {
        setState('waiting'); setPasswordRequired(false)
        const [rtcConfig, material] = await Promise.all([getRtcConfig(), deriveRoomMaterial(secret)])
        if (stopped) return
        room = joinRoom({ appId: 'beamdrop-v2', rtcConfig, password: material.signalingKey }, material.roomId, {
          handshakeTimeoutMs: 5_000,
          onPeerHandshake: async (_peerId, handshakeSend, handshakeReceive, isInitiator) => {
            await authenticatePeer({ roomId: material.roomId, authenticationKey: material.authenticationKey, send: handshakeSend, receive: handshakeReceive, isInitiator })
          },
          onJoinError: ({ error }) => {
            if (stopped || !/handshake|peer authentication|incompatible peer protocol|official release/i.test(error)) return
            // Authentication errors intentionally remain neutral: they do not prove hostile intent.
            setState('verification-failed')
          },
        }) as unknown as RoomLike; roomRef.current = room
        const control = room.makeAction<BeamMessage>(CONTROL), chunks = room.makeAction<Uint8Array>(CHUNK), access = room.makeAction<AccessMessage>(ACCESS), typing = room.makeAction<TypingMessage>(TYPING)
        sendRef.current = async (message, peerId) => { if (peerId) return control.send(message, { target: peerId }); await Promise.all([...sessions.current.values()].filter(session => session.status === 'connected').map(session => control.send(message, { target: session.peerId }))) }
        const clearTypingPeer = (peerId: string) => { const timer = typingTimers.current.get(peerId); if (timer) window.clearTimeout(timer); typingTimers.current.delete(peerId); setTypingPeerIds(current => current.filter(id => id !== peerId)) }
        const receiveTyping = (message: unknown, peerId: string) => {
          const session = sessions.current.get(peerId)
          if (!session || session.status !== 'connected' || !message || typeof message !== 'object' || typeof (message as TypingMessage).active !== 'boolean') return
          if (!(message as TypingMessage).active) { clearTypingPeer(peerId); return }
          setTypingPeerIds(current => current.includes(peerId) ? current : [...current, peerId])
          const previousTimer = typingTimers.current.get(peerId)
          if (previousTimer) window.clearTimeout(previousTimer)
          typingTimers.current.set(peerId, window.setTimeout(() => clearTypingPeer(peerId), TYPING_TIMEOUT))
        }
        typing.onMessage = (message, { peerId }) => receiveTyping(message, peerId)
        sendTypingRef.current = active => {
          const now = Date.now()
          if (active === typingActive.current && (!active || now - typingLastSentAt.current < TYPING_REFRESH_INTERVAL)) return
          typingActive.current = active
          typingLastSentAt.current = now
          const recipients = [...sessions.current.values()].filter(session => session.status === 'connected')
          void Promise.all(recipients.map(session => typing.send({ active }, { target: session.peerId })))
        }
        const hello = (peerId: string) => void control.send({ v: 2, type: 'hello', name: nameRef.current, deviceType: inferDeviceType() }, { target: peerId })
        const addPendingPeer = (peer: Peer) => setPendingPeers(current => current.some(existing => existing.id === peer.id) ? current : [...current, peer])
        const admit = (peerId: string) => {
          const session = sessions.current.get(peerId), token = joinTokens.current.get(peerId)
          if (!session || !token || session.status === 'kicked') return
          session.status = 'authenticated'
          setPendingPeers(current => current.filter(peer => peer.id !== peerId))
          void Promise.all([...sessions.current.values()].filter(candidate => candidate.status !== 'kicked' && candidate.status !== 'disconnected').map(candidate => access.send({ type: 'member-approved', peerId, token }, { target: candidate.peerId })))
          hello(peerId)
        }
        admitPeerRef.current = admit
        room.onPeerJoin = peerId => {
          if (stopped) return
          foundTransportPeer = true
          sessions.current.set(peerId, { peerId, displayName: 'Connected device', role: 'member', status: 'pending', deviceType: 'computer' })
          setState(current => current === 'waiting' ? 'peer-found' : current)
          if (!joined.current) void access.send({ type: 'join-request', name: nameRef.current, deviceType: inferDeviceType(), token: ownJoinToken.current }, { target: peerId })
        }
        room.onPeerLeave = peerId => { const session = sessions.current.get(peerId); if (session) session.status = 'disconnected'; clearTypingPeer(peerId); joinTokens.current.delete(peerId); invalidPeers.current.delete(peerId); setPendingPeers(current => current.filter(peer => peer.id !== peerId)); endOutgoingForPeer(peerId, 'failed'); for (const [key, transfer] of incoming.current) if (transfer.peerId === peerId) { incoming.current.delete(key); updateTransfer(transfer.recordId, { status: 'interrupted' }) }; syncPeers(); if (hadConnectedPeer && ![...sessions.current.values()].some(candidate => candidate.status === 'connected')) recover(); else updateConnectionState() }
        access.onMessage = (message, { peerId }) => {
          if (stopped || isBlocked(peerId) || !message || typeof message !== 'object') { rejectInvalid(peerId); return }
          const session = sessions.current.get(peerId)
          if (!session || session.status === 'kicked') return
          if (message.type === 'join-request') {
            if (joined.current || isCreator) {
              const valid = typeof message.name === 'string' && message.name.length <= 48 && ['phone', 'tablet', 'computer'].includes(message.deviceType) && typeof message.token === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(message.token)
              if (!valid) return
              session.displayName = message.name
              session.deviceType = message.deviceType
              joinTokens.current.set(peerId, message.token)
              const firstGuest = isCreator && ![...sessions.current.values()].some(candidate => candidate.peerId !== peerId && candidate.status === 'connected')
              if (firstGuest || freeForAllRef.current) admit(peerId)
              else addPendingPeer({ id: peerId, name: message.name, deviceType: message.deviceType })
            }
            return
          }
          if (message.type !== 'member-approved' || typeof message.peerId !== 'string' || typeof message.token !== 'string') return
          if (!joined.current && message.token === ownJoinToken.current) {
            joined.current = true
            setPasswordRequired(false)
            for (const candidate of sessions.current.values()) if (candidate.status !== 'kicked' && candidate.status !== 'disconnected') { candidate.status = 'authenticated'; hello(candidate.peerId) }
            return
          }
          const approved = sessions.current.get(message.peerId)
          if (!approved || joinTokens.current.get(message.peerId) !== message.token || session.status !== 'connected') return
          approved.status = 'authenticated'
          setPendingPeers(current => current.filter(peer => peer.id !== message.peerId))
          hello(message.peerId)
        }
        control.onMessage = (raw, { peerId }) => {
          const message = parseMessage(raw); if (!message || stopped || isBlocked(peerId)) { if (!message) rejectInvalid(peerId); return }
          const session = sessions.current.get(peerId); if (!session || !['authenticated', 'connected'].includes(session.status)) return
          if (message.type === 'kick-notice') { if (!isCreator) { setState('kicked'); void room?.leave() }; return }
          if (message.type === 'hello') { session.displayName = message.name; session.deviceType = message.deviceType; session.status = 'connected'; hadConnectedPeer = true; if (recoveryTimer) { clearTimeout(recoveryTimer); recoveryTimer = undefined }; syncPeers(); updateConnectionState(); return }
          if (session.status !== 'connected') return
          if (message.type === 'item') { setFeed(current => [{ id: `${peerId}:${message.item.id}`, kind: message.item.kind, value: message.item.value, url: message.item.kind === 'link' ? message.item.value : undefined, sender: peerName(peerId), createdAt: message.item.createdAt, received: true }, ...current]); return }
          const key = incomingKey(peerId, message.transferId)
          if (message.type === 'file-offer') { if (incoming.current.size >= MAX_ACTIVE_TRANSFERS || incoming.current.has(key)) return; const recordId = key; incoming.current.set(key, { recordId, offer: message, bytes: 0, peerId, accepted: false }); setTransfers(current => [{ id: recordId, transferId: message.transferId, peerId, name: message.name, size: message.size, mimeType: message.mimeType, sender: peerName(peerId), createdAt: Date.now(), direction: 'receiving', status: 'offered', progress: 0, speed: 0 }, ...current]); return }
          if (message.type === 'file-accept') { const transfer = outgoing.current.get(message.transferId), recipient = transfer?.recipients.get(peerId); if (!transfer || !recipient || recipient.status !== 'offered') return; const controller = new AbortController(); recipient.abortController = controller; recipient.status = 'transferring'; updateOutgoingRecord(transfer); void sendFile({ id: transfer.id, file: transfer.file, peerId, sendChunk: (value, target) => chunks.send(value, { target }), sendControl: send, signal: controller.signal, report: (bytesSent, metrics) => { recipient.bytesSent = bytesSent; updateOutgoingRecord(transfer, metrics) } }).then(() => { recipient.abortController = undefined }).catch(() => { if (!isRecipientTerminal(recipient.status)) { recipient.status = controller.signal.aborted ? 'cancelled' : 'failed'; recipient.abortController = undefined; updateOutgoingRecord(transfer) } }); return }
          if (message.type === 'file-decline' || message.type === 'file-cancel') { const transfer = outgoing.current.get(message.transferId), recipient = transfer?.recipients.get(peerId); if (transfer && recipient && !isRecipientTerminal(recipient.status)) { recipient.abortController?.abort(); recipient.abortController = undefined; recipient.status = message.type === 'file-decline' ? 'rejected' : 'cancelled'; updateOutgoingRecord(transfer) }; const received = incoming.current.get(key); if (received) { incoming.current.delete(key); updateTransfer(received.recordId, { status: message.type === 'file-decline' ? 'declined' : 'cancelled' }) }; return }
          if (message.type === 'file-complete') { const received = incoming.current.get(key); if (received?.accepted && received.bytes === received.offer.size) return; const transfer = outgoing.current.get(message.transferId), recipient = transfer?.recipients.get(peerId); if (transfer && recipient && recipient.status === 'transferring' && recipient.bytesSent === transfer.file.size) { recipient.status = 'completed'; recipient.abortController = undefined; updateOutgoingRecord(transfer) } }
        }
        chunks.onMessage = (raw, { peerId }) => { const frame = decodeChunk(raw); if (!frame || isBlocked(peerId)) { rejectInvalid(peerId); return }; const transfer = incoming.current.get(incomingKey(peerId, frame.transferId)); if (!transfer || !transfer.accepted || !transfer.chunks || frame.index !== transfer.chunks.length || frame.index >= transfer.offer.totalChunks) { rejectInvalid(peerId); return }; const expected = Math.min(CHUNK_SIZE, transfer.offer.size - frame.index * CHUNK_SIZE); if (frame.payload.byteLength !== expected || transfer.bytes + expected > transfer.offer.size) { rejectInvalid(peerId); return }; transfer.chunks.push(frame.payload); transfer.bytes += expected; const measurement = (transfer.meter ??= createTransferMeter())(transfer.bytes), now = performance.now(); if (shouldReportProgress(transfer.lastReportedAt ?? 0, now) || transfer.bytes === transfer.offer.size) { transfer.lastReportedAt = now; updateTransfer(transfer.recordId, { status: 'active', progress: transfer.offer.size ? transfer.bytes / transfer.offer.size : 1, speed: measurement.speed, averageSpeed: measurement.averageSpeed, peakSpeed: measurement.peakSpeed, elapsedMs: measurement.elapsedMs }) }; if (transfer.bytes !== transfer.offer.size) return; const objectUrl = URL.createObjectURL(new Blob(transfer.chunks, { type: transfer.offer.mimeType })); updateTransfer(transfer.recordId, { status: 'complete', progress: 1 }); setFeed(current => [{ id: transfer.recordId, kind: 'file', value: transfer.offer.name, size: transfer.offer.size, sender: peerName(peerId), createdAt: Date.now(), received: true, objectUrl }, ...current]); incoming.current.delete(incomingKey(peerId, frame.transferId)); void send({ v: 2, type: 'file-complete', transferId: frame.transferId }, peerId) }
        if (!isCreator) notFound = window.setTimeout(() => { if (!stopped && !foundTransportPeer) { void room?.leave(); setState('not-found') } }, NOT_FOUND_TIMEOUT)
      } catch { if (!stopped) setState('failed') }
    }; void start()
    return () => { stopped = true; sendTypingRef.current(false); typingActive.current = false; if (notFound) clearTimeout(notFound); if (recoveryTimer) clearTimeout(recoveryTimer); for (const timer of typingTimers.current.values()) window.clearTimeout(timer); typingTimers.current.clear(); for (const transfer of outgoing.current.values()) for (const recipient of transfer.recipients.values()) recipient.abortController?.abort(); outgoing.current.clear(); incoming.current.clear(); sessions.current.clear(); joinTokens.current.clear(); invalidPeers.current.clear(); admitPeerRef.current = () => {}; sendTypingRef.current = () => {}; sendRef.current = null; roomRef.current = null; void room?.leave() }
  }, [secret, isCreator, send, updateTransfer, connectionAttempt])

  const sendItem = useCallback((value: string, kind: 'text' | 'link') => { const item = { id: uid(), kind, value: value.trim(), createdAt: Date.now() } as const; if (!item.value) return; void send({ v: 2, type: 'item', item }); setFeed(current => [{ id: item.id, kind, value: item.value, sender: 'You', createdAt: item.createdAt }, ...current]) }, [send])
  const offerFile = useCallback((file: File) => { if (!Number.isFinite(file.size) || file.size < 0 || file.size > MAX_FILE_SIZE) return; const recipients = [...sessions.current.values()].filter(session => session.status === 'connected'); if (!recipients.length) return; const id = uid(), offer: FileOffer = { v: 2, type: 'file-offer', transferId: id, name: file.name.slice(0, 255), size: file.size, mimeType: (file.type || 'application/octet-stream').slice(0, 127), totalChunks: totalChunksFor(file.size) }; const transfer: OutgoingTransfer = { id, file, recipients: new Map(recipients.map(session => [session.peerId, { peerId: session.peerId, status: 'offered', bytesSent: 0 }])) }; outgoing.current.set(id, transfer); void Promise.all(recipients.map(session => send(offer, session.peerId))); setTransfers(current => [{ id, transferId: id, name: offer.name, size: file.size, mimeType: offer.mimeType, sender: 'You', createdAt: Date.now(), direction: 'sending', status: 'offered', progress: 0, speed: 0, file }, ...current]) }, [send])
  const replyToOffer = useCallback((recordId: string, accept: boolean) => { const transfer = [...incoming.current.values()].find(value => value.recordId === recordId); if (!transfer || transfer.accepted) return; transfer.accepted = accept; if (accept) transfer.chunks = []; else incoming.current.delete(incomingKey(transfer.peerId, transfer.offer.transferId)); void send({ v: 2, type: accept ? 'file-accept' : 'file-decline', transferId: transfer.offer.transferId }, transfer.peerId); updateTransfer(recordId, { status: accept ? 'active' : 'declined' }) }, [send, updateTransfer])
  const cancelTransferForPeer = useCallback((transferId: string, peerId: string) => { const transfer = outgoing.current.get(transferId), recipient = transfer?.recipients.get(peerId); if (!transfer || !recipient || isRecipientTerminal(recipient.status)) return; recipient.abortController?.abort(); recipient.abortController = undefined; recipient.status = 'cancelled'; void send({ v: 2, type: 'file-cancel', transferId }, peerId); updateTransfer(transfer.id, outgoingView(transfer)); if (areAllRecipientsTerminal(transfer)) { outgoing.current.delete(transfer.id); updateTransfer(transfer.id, { file: undefined }) } }, [send, updateTransfer])
  const cancelTransfer = useCallback((recordId: string) => { const incomingTransfer = [...incoming.current.values()].find(value => value.recordId === recordId); if (incomingTransfer) { incoming.current.delete(incomingKey(incomingTransfer.peerId, incomingTransfer.offer.transferId)); void send({ v: 2, type: 'file-cancel', transferId: incomingTransfer.offer.transferId }, incomingTransfer.peerId); updateTransfer(recordId, { status: 'cancelled' }); return }; const transfer = outgoing.current.get(recordId); if (transfer) for (const peerId of transfer.recipients.keys()) cancelTransferForPeer(recordId, peerId) }, [cancelTransferForPeer, send, updateTransfer])
  const kickPeer = useCallback((peerId: string) => { if (!isCreator) return; const session = sessions.current.get(peerId); if (session) session.status = 'kicked'; const timer = typingTimers.current.get(peerId); if (timer) window.clearTimeout(timer); typingTimers.current.delete(peerId); setTypingPeerIds(current => current.filter(id => id !== peerId)); endTransfersForKick(outgoing.current, peerId, updateTransfer); void send({ v: 2, type: 'kick-notice' }, peerId); setPeers(current => current.filter(peer => peer.id !== peerId)) }, [isCreator, send, updateTransfer])
  const admitPeer = useCallback((peerId: string) => admitPeerRef.current(peerId), [])
  const setFreeForAll = useCallback((enabled: boolean) => { if (!isCreator) return; freeForAllRef.current = enabled; setFreeForAllState(enabled) }, [isCreator])
  return { state, passwordRequired, peers, pendingPeers, feed, transfers, typingPeerIds, setTyping, sendItem, offerFile, replyToOffer, cancelTransfer, cancelTransferForPeer, admitPeer, kickPeer, freeForAll, setFreeForAll, retryConnection, getDiagnostics: async (): Promise<RtcDiagnostics[]> => roomRef.current ? getRoomDiagnostics(roomRef.current.getPeers()) : [] }
}

function endTransfersForKick(transfers: Map<string, OutgoingTransfer>, peerId: string, update: (id: string, change: Partial<TransferRecord>) => void) { for (const transfer of [...transfers.values()]) { const recipient = transfer.recipients.get(peerId); if (!recipient || isRecipientTerminal(recipient.status)) continue; recipient.abortController?.abort(); recipient.abortController = undefined; recipient.status = 'cancelled'; update(transfer.id, outgoingView(transfer)); if (areAllRecipientsTerminal(transfer)) { transfers.delete(transfer.id); update(transfer.id, { file: undefined }) } } }
async function sendFile({ id, file, peerId, sendChunk, sendControl, signal, report }: { id: string; file: File; peerId: string; sendChunk: (data: Uint8Array, peerId: string) => Promise<void>; sendControl: Sender<BeamMessage>; signal: AbortSignal; report: (bytesSent: number, metrics: { speed: number; averageSpeed: number; peakSpeed: number; elapsedMs: number }) => void }) { let offset = 0, index = 0, sent = 0, last = 0; const meter = createTransferMeter(); const prepared: Promise<{ body: Uint8Array; index: number } | null>[] = []; const prepare = async () => { if (signal.aborted || offset >= file.size) return null; const start = offset, chunkIndex = index; offset += CHUNK_SIZE; index += 1; return { body: new Uint8Array(await file.slice(start, Math.min(start + CHUNK_SIZE, file.size)).arrayBuffer()), index: chunkIndex } }; const fill = () => { while (prepared.length < PREPARED_CHUNK_COUNT && offset < file.size) prepared.push(prepare()) }; fill(); try { while (prepared.length) { const item = await prepared.shift(); if (!item || signal.aborted) return; await sendChunk(encodeChunk(id, item.index, item.body), peerId); sent += item.body.byteLength; fill(); const measurement = meter(sent), now = performance.now(); if (shouldReportProgress(last, now) || sent === file.size) { last = now; report(sent, measurement) } } if (!signal.aborted) await sendControl({ v: 2, type: 'file-complete', transferId: id }, peerId) } finally { await Promise.allSettled(prepared) } }
