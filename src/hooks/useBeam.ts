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
export type FeedItem = { id: string; kind: 'text' | 'link' | 'file' | 'system' | 'canvas'; value: string; sender: string; createdAt: number; size?: number; url?: string; received?: boolean; objectUrl?: string }
export type CanvasPoint = { x: number; y: number }
export type CanvasShape = 'freehand' | 'line' | 'arrow' | 'rectangle' | 'ellipse' | 'diamond'
export type CanvasStroke = { id: string; points: CanvasPoint[]; color: string; width: number; author: string; shape?: CanvasShape; fill?: string }
export type CanvasImage = { id: string; dataUrl: string; x: number; y: number; width: number; height: number; author: string }
export type CanvasSession = { id: string; name: string; starter: string; createdAt: number; strokes: CanvasStroke[]; images: CanvasImage[] }
export type CanvasTraffic = { sent: number; received: number }
export type CanvasPresence = { id: string; name: string; point: CanvasPoint }
export type TransferRecord = { id: string; transferId: string; peerId?: string; name: string; size: number; mimeType: string; sender: string; createdAt: number; direction: 'sending' | 'receiving'; status: 'offered' | 'active' | 'complete' | 'declined' | 'cancelled' | 'interrupted'; progress: number; speed: number; averageSpeed?: number; peakSpeed?: number; elapsedMs?: number; file?: File }
export type Peer = { id: string; name: string; deviceType: DeviceType }
type PeerSession = { peerId: string; displayName: string; role: 'creator' | 'member'; status: 'pending' | 'authenticated' | 'connected' | 'disconnected' | 'kicked'; deviceType: DeviceType }
type Sender<T> = (data: T, peerId?: string) => Promise<void>
type RoomLike = { makeAction<T>(name: string): { send(data: T, options?: { target?: string }): Promise<void>; onMessage: ((data: T, context: { peerId: string }) => void) | null }; onPeerJoin: ((peerId: string) => void) | null; onPeerLeave: ((peerId: string) => void) | null; getPeers(): Record<string, RTCPeerConnection>; leave(): Promise<void> }
type Incoming = { recordId: string; offer: FileOffer; chunks?: Uint8Array[]; bytes: number; peerId: string; accepted: boolean; meter?: ReturnType<typeof createTransferMeter>; lastReportedAt?: number }
type AccessMessage =
  | { type: 'join-request'; name: string; deviceType: DeviceType; token: string }
  | { type: 'member-approved'; peerId: string; token: string }
type CanvasMessage =
  | { type: 'start'; canvas: CanvasSession }
  | { type: 'join'; canvasId: string }
  | { type: 'sync-request'; canvasId: string }
  | { type: 'sync'; canvas: CanvasSession }
  | { type: 'rename'; canvasId: string; name: string }
  | { type: 'stroke'; canvasId: string; stroke: CanvasStroke }
  | { type: 'stroke-start'; canvasId: string; stroke: Omit<CanvasStroke, 'points'>; point: CanvasPoint }
  | { type: 'stroke-points'; canvasId: string; id: string; points: number[] }
  | { type: 'drawing'; canvasId: string; point: CanvasPoint }
  | { type: 'drawing-stop'; canvasId: string }
  | { type: 'image'; canvasId: string; image: CanvasImage }
  | { type: 'delete'; canvasId: string; id: string }
const CONTROL = 'beam-control-v2', CHUNK = 'beam-chunk-v2', ACCESS = 'beam-access-v2', CANVAS = 'beam-canvas-v2', HANDSHAKE_TIMEOUT = 15_000, DISCOVERY_RETRY_TIMEOUT = 20_000
const uid = () => crypto.randomUUID?.().replaceAll('-', '_') ?? `${Date.now()}_${crypto.getRandomValues(new Uint32Array(1))[0]}`
const canvasMessageBytes = (message: CanvasMessage) => new TextEncoder().encode(JSON.stringify(message)).byteLength
// Half-pixel precision is visually indistinguishable here, but keeps live drawing packets compact.
const compactPoint = (point: CanvasPoint, dataSaver = false) => dataSaver
  ? { x: Math.round(point.x), y: Math.round(point.y) }
  : { x: Math.round(point.x * 2) / 2, y: Math.round(point.y * 2) / 2 }
const compactPoints = (points: CanvasPoint[], dataSaver = false) => points.flatMap(point => { const compact = compactPoint(point, dataSaver); return [compact.x, compact.y] })
const expandPoints = (points: number[]) => points.reduce<CanvasPoint[]>((result, value, index) => index % 2 ? [...result, { x: points[index - 1], y: value }] : result, [])
const incomingKey = (peerId: string, transferId: string) => `${peerId}:${transferId}`
function outgoingView(transfer: OutgoingTransfer): Pick<TransferRecord, 'status' | 'progress'> {
  const recipients = [...transfer.recipients.values()]
  const complete = recipients.length > 0 && recipients.every(recipient => recipient.status === 'completed')
  const terminal = recipients.length > 0 && recipients.every(recipient => isRecipientTerminal(recipient.status))
  const status: TransferRecord['status'] = complete ? 'complete' : terminal ? recipients.some(recipient => recipient.status === 'failed') ? 'interrupted' : recipients.some(recipient => recipient.status === 'cancelled') ? 'cancelled' : 'declined' : recipients.some(recipient => recipient.status === 'transferring' || recipient.status === 'accepted') ? 'active' : 'offered'
  const bytesSent = recipients.reduce((sum, recipient) => sum + recipient.bytesSent, 0)
  return { status, progress: transfer.file.size && recipients.length ? bytesSent / (transfer.file.size * recipients.length) : complete ? 1 : 0 }
}

export function useBeam(secret: string | null, _password: string, displayName: string, isCreator: boolean, dataSaver: boolean) {
  const [state, setState] = useState<ConnectionState>(secret ? 'waiting' : 'idle')
  const [passwordRequired, setPasswordRequired] = useState(false)
  const [peers, setPeers] = useState<Peer[]>([])
  const [pendingPeers, setPendingPeers] = useState<Peer[]>([])
  const [feed, setFeed] = useState<FeedItem[]>([])
  const [transfers, setTransfers] = useState<TransferRecord[]>([])
  const [freeForAll, setFreeForAllState] = useState(false)
  const [canvas, setCanvas] = useState<CanvasSession | null>(null)
  const [canvasTraffic, setCanvasTraffic] = useState<CanvasTraffic>({ sent: 0, received: 0 })
  const [canvasPresence, setCanvasPresence] = useState<CanvasPresence[]>([])
  const [typingPeers, setTypingPeers] = useState<Peer[]>([])
  const [hasConnected, setHasConnected] = useState(false)
  const [connectionAttempt, setConnectionAttempt] = useState(0)
  const roomRef = useRef<RoomLike | null>(null), sendRef = useRef<Sender<BeamMessage> | null>(null)
  const incoming = useRef(new Map<string, Incoming>()), outgoing = useRef(new Map<string, OutgoingTransfer>()), sessions = useRef(new Map<string, PeerSession>()), nameRef = useRef(displayName), joinTokens = useRef(new Map<string, string>()), ownJoinToken = useRef(uid()), joined = useRef(isCreator), freeForAllRef = useRef(false), admitPeerRef = useRef<(peerId: string) => void>(() => {}), invalidPeers = useRef(new Map<string, number>()), sendHelloRef = useRef<() => void>(() => {}), dataSaverRef = useRef(dataSaver), freshBeamOnNextConnection = useRef(false), typingExpiry = useRef(new Map<string, number>()), typingActive = useRef(false), lastTypingSignalAt = useRef(0)
  useEffect(() => { nameRef.current = displayName }, [displayName])
  useEffect(() => { dataSaverRef.current = dataSaver }, [dataSaver])
  const updateTransfer = useCallback((id: string, update: Partial<TransferRecord>) => setTransfers(current => current.map(item => item.id === id ? { ...item, ...update } : item)), [])
  const send = useCallback(async (message: BeamMessage, peerId?: string) => { await sendRef.current?.(message, peerId) }, [])
  const addSystemEntry = useCallback((id: string, value: string, createdAt = Date.now()) => setFeed(current => current.some(item => item.id === id) ? current : [{ id, kind: 'system', value, sender: 'System', createdAt }, ...current]), [])
  const retryConnection = useCallback(() => setConnectionAttempt(current => current + 1), [])
  const canvasSendRef = useRef<((message: CanvasMessage, peerId?: string) => Promise<void>) | null>(null)
  const canvasRef = useRef<CanvasSession | null>(null)
  const drawingExpiry = useRef(new Map<string, number>())
  useEffect(() => { canvasRef.current = canvas }, [canvas])

  useEffect(() => {
    if (!secret) return
    addEventListener('online', retryConnection)
    return () => removeEventListener('online', retryConnection)
  }, [secret, retryConnection])

  useEffect(() => {
    if (!secret) { setState('idle'); return }
    let stopped = false; let room: RoomLike | null = null; let notFound: number | undefined; let recoveryTimer: number | undefined; let foundTransportPeer = false; let hadConnectedPeer = false
    const joinRequestTimers = new Map<string, number>()
    // A remaining guest becomes the host for the restarted Beam. Do not reset
    // its admission capability while refreshing the signaling room.
    joined.current = isCreator || joined.current; ownJoinToken.current = uid(); freeForAllRef.current = false; setFreeForAllState(false); setPendingPeers([])
    const syncPeers = () => setPeers([...sessions.current.values()].filter(session => session.status === 'connected').map(session => ({ id: session.peerId, name: session.displayName, deviceType: session.deviceType })))
    const rejectInvalid = (peerId: string) => { const count = (invalidPeers.current.get(peerId) ?? 0) + 1; invalidPeers.current.set(peerId, count); return count >= 8 }
    const isBlocked = (peerId: string) => (invalidPeers.current.get(peerId) ?? 0) >= 8
    const updateConnectionState = () => { if (!stopped) setState([...sessions.current.values()].some(session => session.status === 'connected') ? 'connected' : 'waiting') }
    const restartRoom = () => {
      if (stopped || recoveryTimer) return
      setState('waiting')
      recoveryTimer = window.setTimeout(() => {
        if (!stopped) setConnectionAttempt(current => current + 1)
      }, 1_500)
    }
    const clearPreviousBeam = () => {
      // The person who stayed can review the previous Beam while waiting. Once
      // someone new joins, make the restarted Beam a clean, private session.
      setFeed(current => {
        for (const item of current) if (item.objectUrl) URL.revokeObjectURL(item.objectUrl)
        return []
      })
      setTransfers([])
      incoming.current.clear()
      for (const transfer of outgoing.current.values()) for (const recipient of transfer.recipients.values()) recipient.abortController?.abort()
      outgoing.current.clear()
      for (const expiry of drawingExpiry.current.values()) window.clearTimeout(expiry)
      drawingExpiry.current.clear()
      for (const expiry of typingExpiry.current.values()) window.clearTimeout(expiry)
      typingExpiry.current.clear()
      setTypingPeers([])
      canvasRef.current = null
      setCanvas(null)
      setCanvasTraffic({ sent: 0, received: 0 })
      setCanvasPresence([])
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
          // Handshakes run over the newly opened data channel. Allow slower
          // browsers and background tabs enough time to complete it before a
          // discovery retry tears down the pending connection.
          handshakeTimeoutMs: HANDSHAKE_TIMEOUT,
          onPeerHandshake: async (_peerId, handshakeSend, handshakeReceive, isInitiator) => {
            await authenticatePeer({ roomId: material.roomId, authenticationKey: material.authenticationKey, send: handshakeSend, receive: handshakeReceive, isInitiator })
          },
          onJoinError: ({ error }) => {
            if (stopped) return
            // A pending connection can close during ICE negotiation or while a
            // tab is backgrounded. That is recoverable, not proof that the
            // other device failed authentication.
            if (/peer authentication failed|invalid peer authentication message|incompatible peer protocol|official release verification required|incorrect password/i.test(error)) {
              setState('verification-failed')
            }
          },
        }) as unknown as RoomLike; roomRef.current = room
        const control = room.makeAction<BeamMessage>(CONTROL), chunks = room.makeAction<Uint8Array>(CHUNK), access = room.makeAction<AccessMessage>(ACCESS), canvasAction = room.makeAction<CanvasMessage>(CANVAS)
        sendRef.current = async (message, peerId) => { if (peerId) return control.send(message, { target: peerId }); await Promise.all([...sessions.current.values()].filter(session => session.status === 'connected').map(session => control.send(message, { target: session.peerId }))) }
        canvasSendRef.current = async (message, peerId) => {
          const bytes = canvasMessageBytes(message)
          if (peerId) {
            await canvasAction.send(message, { target: peerId })
            setCanvasTraffic(current => ({ ...current, sent: current.sent + bytes }))
            return
          }
          const sends = await Promise.allSettled([...sessions.current.values()].filter(session => session.status === 'connected').map(session => canvasAction.send(message, { target: session.peerId })))
          const delivered = sends.filter(result => result.status === 'fulfilled').length
          if (delivered) setCanvasTraffic(current => ({ ...current, sent: current.sent + bytes * delivered }))
        }
        const validCanvas = (value: unknown): value is CanvasSession => {
          if (!value || typeof value !== 'object') return false
          const item = value as CanvasSession
          return typeof item.id === 'string' && item.id.length <= 128 && typeof item.name === 'string' && item.name.length <= 80 && typeof item.starter === 'string' && item.starter.length <= 48 && Number.isFinite(item.createdAt) && Array.isArray(item.strokes) && item.strokes.length <= 2000 && Array.isArray(item.images) && item.images.length <= 40
        }
        canvasAction.onMessage = (message, { peerId }) => {
          const session = sessions.current.get(peerId)
          if (!session || session.status !== 'connected' || !message || typeof message !== 'object') return
          if (message.type === 'start' && validCanvas(message.canvas)) {
            const bytes = canvasMessageBytes(message)
            setCanvasTraffic(current => canvasRef.current?.id === message.canvas.id ? { ...current, received: current.received + bytes } : { sent: 0, received: bytes })
            setCanvas(current => current?.id === message.canvas.id ? current : message.canvas)
            setFeed(current => current.some(item => item.id === `canvas:${message.canvas.id}`) ? current : [{ id: `canvas:${message.canvas.id}`, kind: 'canvas', value: message.canvas.name, sender: peerName(peerId), createdAt: message.canvas.createdAt, received: true }, ...current])
          } else if (message.type === 'sync-request' && canvasRef.current?.id === message.canvasId) {
            void canvasSendRef.current?.({ type: 'sync', canvas: canvasRef.current }, peerId)
          } else if (message.type === 'sync' && validCanvas(message.canvas)) {
            const bytes = canvasMessageBytes(message)
            setCanvasTraffic(current => canvasRef.current?.id === message.canvas.id ? { ...current, received: current.received + bytes } : { sent: 0, received: bytes })
            setCanvas(current => current?.id === message.canvas.id ? current : message.canvas)
          } else if (message.type === 'rename' && canvasRef.current?.id === message.canvasId && session.displayName === canvasRef.current.starter && typeof message.name === 'string' && message.name.trim().length <= 80) {
            const name = message.name.trim()
            setCanvasTraffic(current => ({ ...current, received: current.received + canvasMessageBytes(message) }))
            setCanvas(current => current ? { ...current, name } : current)
            setFeed(current => current.map(item => item.id === `canvas:${message.canvasId}` ? { ...item, value: name } : item))
          } else if (message.type === 'stroke' && canvasRef.current?.id === message.canvasId && message.stroke && typeof message.stroke.id === 'string' && Array.isArray(message.stroke.points) && message.stroke.points.length <= 2000) {
            setCanvasTraffic(current => ({ ...current, received: current.received + canvasMessageBytes(message) }))
            setCanvas(current => {
              if (!current || current.id !== message.canvasId) return current
              const index = current.strokes.findIndex(stroke => stroke.id === message.stroke.id)
              if (index < 0) return { ...current, strokes: [...current.strokes, message.stroke] }
              if (current.strokes[index].points.length > message.stroke.points.length) return current
              return { ...current, strokes: current.strokes.map((stroke, candidate) => candidate === index ? message.stroke : stroke) }
            })
          } else if (message.type === 'stroke-start' && canvasRef.current?.id === message.canvasId && message.stroke && typeof message.stroke.id === 'string' && Number.isFinite(message.point.x) && Number.isFinite(message.point.y)) {
            setCanvasTraffic(current => ({ ...current, received: current.received + canvasMessageBytes(message) }))
            const stroke: CanvasStroke = { ...message.stroke, points: [compactPoint(message.point)] }
            setCanvas(current => current && current.id === message.canvasId && !current.strokes.some(candidate => candidate.id === stroke.id) ? { ...current, strokes: [...current.strokes, stroke] } : current)
          } else if (message.type === 'stroke-points' && canvasRef.current?.id === message.canvasId && typeof message.id === 'string' && Array.isArray(message.points) && message.points.length <= 400 && message.points.length % 2 === 0 && message.points.every(Number.isFinite)) {
            setCanvasTraffic(current => ({ ...current, received: current.received + canvasMessageBytes(message) }))
            const points = expandPoints(message.points)
            setCanvas(current => {
              if (!current || current.id !== message.canvasId || !points.length) return current
              return { ...current, strokes: current.strokes.map(stroke => stroke.id === message.id ? { ...stroke, points: [...stroke.points, ...points] } : stroke) }
            })
          } else if (message.type === 'drawing' && canvasRef.current?.id === message.canvasId && message.point && Number.isFinite(message.point.x) && Number.isFinite(message.point.y)) {
            setCanvasTraffic(current => ({ ...current, received: current.received + canvasMessageBytes(message) }))
            const previousExpiry = drawingExpiry.current.get(peerId)
            if (previousExpiry) window.clearTimeout(previousExpiry)
            setCanvasPresence(current => [...current.filter(presence => presence.id !== peerId), { id: peerId, name: peerName(peerId), point: compactPoint(message.point) }])
            drawingExpiry.current.set(peerId, window.setTimeout(() => {
              drawingExpiry.current.delete(peerId)
              setCanvasPresence(current => current.filter(presence => presence.id !== peerId))
            }, 1_500))
          } else if (message.type === 'drawing-stop' && canvasRef.current?.id === message.canvasId) {
            setCanvasTraffic(current => ({ ...current, received: current.received + canvasMessageBytes(message) }))
            const expiry = drawingExpiry.current.get(peerId)
            if (expiry) window.clearTimeout(expiry)
            drawingExpiry.current.delete(peerId)
            setCanvasPresence(current => current.filter(presence => presence.id !== peerId))
          } else if (message.type === 'image' && canvasRef.current?.id === message.canvasId && message.image && typeof message.image.id === 'string' && typeof message.image.dataUrl === 'string' && message.image.dataUrl.length <= 1_400_000) {
            setCanvasTraffic(current => ({ ...current, received: current.received + canvasMessageBytes(message) }))
            setCanvas(current => current && current.id === message.canvasId && !current.images.some(image => image.id === message.image.id) ? { ...current, images: [...current.images, message.image] } : current)
          } else if (message.type === 'delete' && canvasRef.current?.id === message.canvasId && typeof message.id === 'string' && message.id.length <= 128) {
            setCanvasTraffic(current => ({ ...current, received: current.received + canvasMessageBytes(message) }))
            setCanvas(current => current?.id === message.canvasId ? { ...current, strokes: current.strokes.filter(stroke => stroke.id !== message.id), images: current.images.filter(image => image.id !== message.id) } : current)
          }
        }
        const hello = (peerId: string) => {
          void control.send({ v: 2, type: 'hello', name: nameRef.current, deviceType: inferDeviceType() }, { target: peerId })
          if (dataSaverRef.current) void control.send({ v: 2, type: 'data-saver', enabled: true }, { target: peerId })
        }
        const stopJoinRequest = (peerId: string) => {
          const timer = joinRequestTimers.get(peerId)
          if (timer) window.clearTimeout(timer)
          joinRequestTimers.delete(peerId)
        }
        const requestAdmission = (peerId: string) => {
          if (stopped || joined.current || !sessions.current.has(peerId)) return
          void access.send({ type: 'join-request', name: nameRef.current, deviceType: inferDeviceType(), token: ownJoinToken.current }, { target: peerId })
          stopJoinRequest(peerId)
          joinRequestTimers.set(peerId, window.setTimeout(() => requestAdmission(peerId), 1_500))
        }
        sendHelloRef.current = () => { for (const session of sessions.current.values()) if (session.status === 'connected') hello(session.peerId) }
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
          if (!joined.current) requestAdmission(peerId)
        }
        room.onPeerLeave = peerId => { stopJoinRequest(peerId); const session = sessions.current.get(peerId); if (session?.status === 'connected') addSystemEntry(uid(), `${session.displayName} left the Beam.`); if (session) session.status = 'disconnected'; joinTokens.current.delete(peerId); invalidPeers.current.delete(peerId); const typingTimer = typingExpiry.current.get(peerId); if (typingTimer) window.clearTimeout(typingTimer); typingExpiry.current.delete(peerId); setTypingPeers(current => current.filter(peer => peer.id !== peerId)); setPendingPeers(current => current.filter(peer => peer.id !== peerId)); endOutgoingForPeer(peerId, 'failed'); for (const [key, transfer] of incoming.current) if (transfer.peerId === peerId) { incoming.current.delete(key); updateTransfer(transfer.recordId, { status: 'interrupted' }) }; syncPeers(); if (hadConnectedPeer && ![...sessions.current.values()].some(candidate => candidate.status === 'connected')) {
          // Keep this room's discovery listener alive. Recreating it here
          // races a WaitingScreen user trying to rejoin the still-visible
          // ConnectedPage, leaving each side on a different attempt.
          freshBeamOnNextConnection.current = true
          updateConnectionState()
        } else updateConnectionState() }
        access.onMessage = (message, { peerId }) => {
          if (stopped || isBlocked(peerId) || !message || typeof message !== 'object') { rejectInvalid(peerId); return }
          const session = sessions.current.get(peerId)
          if (!session || session.status === 'kicked') return
          if (message.type === 'join-request') {
            const valid = typeof message.name === 'string' && message.name.length <= 48 && ['phone', 'tablet', 'computer'].includes(message.deviceType) && typeof message.token === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(message.token)
            if (!valid) return
            session.displayName = message.name
            session.deviceType = message.deviceType
            joinTokens.current.set(peerId, message.token)
            const firstGuest = ![...sessions.current.values()].some(candidate => candidate.peerId !== peerId && candidate.status === 'connected')

            // There is no room directory or durable host. When two browsers
            // independently search for the same code, both start as guests;
            // let the first pair bootstrap the Beam. Once a participant is
            // connected, the normal approval policy applies again.
            if (joined.current || isCreator || firstGuest) {
              if (firstGuest || freeForAllRef.current) admit(peerId)
              else addPendingPeer({ id: peerId, name: message.name, deviceType: message.deviceType })
            }
            return
          }
          if (message.type !== 'member-approved' || typeof message.peerId !== 'string' || typeof message.token !== 'string') return
          if (!joined.current && message.token === ownJoinToken.current) {
            joined.current = true
            for (const peerId of joinRequestTimers.keys()) stopJoinRequest(peerId)
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
          if (message.type === 'data-saver') return
          if (message.type === 'typing') { const previousExpiry = typingExpiry.current.get(peerId); if (previousExpiry) window.clearTimeout(previousExpiry); if (!message.active) { typingExpiry.current.delete(peerId); setTypingPeers(current => current.filter(peer => peer.id !== peerId)); return }; setTypingPeers(current => current.some(peer => peer.id === peerId) ? current : [...current, { id: peerId, name: peerName(peerId), deviceType: session.deviceType }]); typingExpiry.current.set(peerId, window.setTimeout(() => { typingExpiry.current.delete(peerId); setTypingPeers(current => current.filter(peer => peer.id !== peerId)) }, 2_500)); return }
          if (message.type === 'kick-notice') { if (!isCreator) { setState('kicked'); void room?.leave() }; return }
          if (message.type === 'hello') { const wasConnected = session.status === 'connected', previousName = session.displayName; session.displayName = message.name; session.deviceType = message.deviceType; session.status = 'connected'; hadConnectedPeer = true; setHasConnected(true); if (!wasConnected) { if (freshBeamOnNextConnection.current) { freshBeamOnNextConnection.current = false; clearPreviousBeam() }; addSystemEntry(uid(), `${message.name} joined the Beam.`); if (canvasRef.current) void canvasSendRef.current?.({ type: 'sync', canvas: canvasRef.current }, peerId) } else if (previousName !== message.name) addSystemEntry(uid(), `${previousName} changed their nickname to ${message.name}.`); if (recoveryTimer) { clearTimeout(recoveryTimer); recoveryTimer = undefined }; syncPeers(); updateConnectionState(); return }
          if (session.status !== 'connected') return
          if (message.type === 'system-event') { if (message.event === 'nickname-changed') { session.displayName = message.nextName!; syncPeers(); addSystemEntry(`${peerId}:${message.id}`, `${message.previousName} changed their nickname to ${message.nextName}.`, message.createdAt) } else if (message.enabled !== undefined) addSystemEntry(`${peerId}:${message.id}`, `${peerName(peerId)} changed the setting: Free for all ${message.enabled ? 'enabled' : 'disabled'}.`, message.createdAt); return }
          if (message.type === 'item') { setFeed(current => [{ id: `${peerId}:${message.item.id}`, kind: message.item.kind, value: message.item.value, url: message.item.kind === 'link' ? message.item.value : undefined, sender: peerName(peerId), createdAt: message.item.createdAt, received: true }, ...current]); return }
          const key = incomingKey(peerId, message.transferId)
          if (message.type === 'file-offer') { if (incoming.current.size >= MAX_ACTIVE_TRANSFERS || incoming.current.has(key)) return; const recordId = key; incoming.current.set(key, { recordId, offer: message, bytes: 0, peerId, accepted: false }); setTransfers(current => [{ id: recordId, transferId: message.transferId, peerId, name: message.name, size: message.size, mimeType: message.mimeType, sender: peerName(peerId), createdAt: Date.now(), direction: 'receiving', status: 'offered', progress: 0, speed: 0 }, ...current]); return }
          if (message.type === 'file-accept') { const transfer = outgoing.current.get(message.transferId), recipient = transfer?.recipients.get(peerId); if (!transfer || !recipient || recipient.status !== 'offered') return; const controller = new AbortController(); recipient.abortController = controller; recipient.status = 'transferring'; updateOutgoingRecord(transfer); void sendFile({ id: transfer.id, file: transfer.file, peerId, sendChunk: (value, target) => chunks.send(value, { target }), sendControl: send, signal: controller.signal, report: (bytesSent, metrics) => { recipient.bytesSent = bytesSent; updateOutgoingRecord(transfer, metrics) } }).then(() => { recipient.abortController = undefined }).catch(() => { if (!isRecipientTerminal(recipient.status)) { recipient.status = controller.signal.aborted ? 'cancelled' : 'failed'; recipient.abortController = undefined; updateOutgoingRecord(transfer) } }); return }
          if (message.type === 'file-decline' || message.type === 'file-cancel') { const transfer = outgoing.current.get(message.transferId), recipient = transfer?.recipients.get(peerId); if (transfer && recipient && !isRecipientTerminal(recipient.status)) { recipient.abortController?.abort(); recipient.abortController = undefined; recipient.status = message.type === 'file-decline' ? 'rejected' : 'cancelled'; updateOutgoingRecord(transfer) }; const received = incoming.current.get(key); if (received) { incoming.current.delete(key); updateTransfer(received.recordId, { status: message.type === 'file-decline' ? 'declined' : 'cancelled' }) }; return }
          if (message.type === 'file-complete') { const received = incoming.current.get(key); if (received?.accepted && received.bytes === received.offer.size) return; const transfer = outgoing.current.get(message.transferId), recipient = transfer?.recipients.get(peerId); if (transfer && recipient && recipient.status === 'transferring' && recipient.bytesSent === transfer.file.size) { recipient.status = 'completed'; recipient.abortController = undefined; updateOutgoingRecord(transfer) } }
        }
        chunks.onMessage = (raw, { peerId }) => { const frame = decodeChunk(raw); if (!frame || isBlocked(peerId)) { rejectInvalid(peerId); return }; const transfer = incoming.current.get(incomingKey(peerId, frame.transferId)); if (!transfer || !transfer.accepted || !transfer.chunks || frame.index !== transfer.chunks.length || frame.index >= transfer.offer.totalChunks) { rejectInvalid(peerId); return }; const expected = Math.min(CHUNK_SIZE, transfer.offer.size - frame.index * CHUNK_SIZE); if (frame.payload.byteLength !== expected || transfer.bytes + expected > transfer.offer.size) { rejectInvalid(peerId); return }; transfer.chunks.push(frame.payload); transfer.bytes += expected; const measurement = (transfer.meter ??= createTransferMeter())(transfer.bytes), now = performance.now(); if (shouldReportProgress(transfer.lastReportedAt ?? 0, now) || transfer.bytes === transfer.offer.size) { transfer.lastReportedAt = now; updateTransfer(transfer.recordId, { status: 'active', progress: transfer.offer.size ? transfer.bytes / transfer.offer.size : 1, speed: measurement.speed, averageSpeed: measurement.averageSpeed, peakSpeed: measurement.peakSpeed, elapsedMs: measurement.elapsedMs }) }; if (transfer.bytes !== transfer.offer.size) return; const objectUrl = URL.createObjectURL(new Blob(transfer.chunks, { type: transfer.offer.mimeType })); updateTransfer(transfer.recordId, { status: 'complete', progress: 1 }); setFeed(current => [{ id: transfer.recordId, kind: 'file', value: transfer.offer.name, size: transfer.offer.size, sender: peerName(peerId), createdAt: Date.now(), received: true, objectUrl }, ...current]); incoming.current.delete(incomingKey(peerId, frame.transferId)); void send({ v: 2, type: 'file-complete', transferId: frame.transferId }, peerId) }
        if (!isCreator) notFound = window.setTimeout(() => { if (!stopped && !foundTransportPeer) restartRoom() }, DISCOVERY_RETRY_TIMEOUT)
      } catch { if (!stopped) setState('failed') }
    }; void start()
    return () => { stopped = true; if (notFound) clearTimeout(notFound); if (recoveryTimer) clearTimeout(recoveryTimer); for (const timer of joinRequestTimers.values()) window.clearTimeout(timer); joinRequestTimers.clear(); for (const expiry of drawingExpiry.current.values()) window.clearTimeout(expiry); drawingExpiry.current.clear(); for (const expiry of typingExpiry.current.values()) window.clearTimeout(expiry); typingExpiry.current.clear(); setTypingPeers([]); setCanvasPresence([]); for (const transfer of outgoing.current.values()) for (const recipient of transfer.recipients.values()) recipient.abortController?.abort(); outgoing.current.clear(); incoming.current.clear(); sessions.current.clear(); joinTokens.current.clear(); invalidPeers.current.clear(); admitPeerRef.current = () => {}; sendHelloRef.current = () => {}; sendRef.current = null; canvasSendRef.current = null; roomRef.current = null; void room?.leave() }
  }, [secret, isCreator, send, updateTransfer, connectionAttempt, addSystemEntry])

  const sendItem = useCallback((value: string, kind: 'text' | 'link') => { const item = { id: uid(), kind, value: value.trim().slice(0, 8_000), createdAt: Date.now() } as const; if (!item.value) return; void send({ v: 2, type: 'item', item }); setFeed(current => [{ id: item.id, kind, value: item.value, sender: 'You', createdAt: item.createdAt }, ...current]) }, [send])
  const setTyping = useCallback((active: boolean) => { if (dataSaverRef.current) return; const now = performance.now(); if (active && typingActive.current && now - lastTypingSignalAt.current < 1_500) return; if (!active && !typingActive.current) return; typingActive.current = active; lastTypingSignalAt.current = now; void send({ v: 2, type: 'typing', active }) }, [send])
  const offerFile = useCallback((file: File) => { if (!Number.isFinite(file.size) || file.size < 0 || file.size > MAX_FILE_SIZE) return; const recipients = [...sessions.current.values()].filter(session => session.status === 'connected'); if (!recipients.length) return; const id = uid(), offer: FileOffer = { v: 2, type: 'file-offer', transferId: id, name: file.name.slice(0, 255), size: file.size, mimeType: (file.type || 'application/octet-stream').slice(0, 127), totalChunks: totalChunksFor(file.size) }; const transfer: OutgoingTransfer = { id, file, recipients: new Map(recipients.map(session => [session.peerId, { peerId: session.peerId, status: 'offered', bytesSent: 0 }])) }; outgoing.current.set(id, transfer); void Promise.all(recipients.map(session => send(offer, session.peerId))); setTransfers(current => [{ id, transferId: id, name: offer.name, size: file.size, mimeType: offer.mimeType, sender: 'You', createdAt: Date.now(), direction: 'sending', status: 'offered', progress: 0, speed: 0, file }, ...current]) }, [send])
  const replyToOffer = useCallback((recordId: string, accept: boolean) => { const transfer = [...incoming.current.values()].find(value => value.recordId === recordId); if (!transfer || transfer.accepted) return; transfer.accepted = accept; if (accept) transfer.chunks = []; else incoming.current.delete(incomingKey(transfer.peerId, transfer.offer.transferId)); void send({ v: 2, type: accept ? 'file-accept' : 'file-decline', transferId: transfer.offer.transferId }, transfer.peerId); updateTransfer(recordId, { status: accept ? 'active' : 'declined' }) }, [send, updateTransfer])
  const cancelTransferForPeer = useCallback((transferId: string, peerId: string) => { const transfer = outgoing.current.get(transferId), recipient = transfer?.recipients.get(peerId); if (!transfer || !recipient || isRecipientTerminal(recipient.status)) return; recipient.abortController?.abort(); recipient.abortController = undefined; recipient.status = 'cancelled'; void send({ v: 2, type: 'file-cancel', transferId }, peerId); updateTransfer(transfer.id, outgoingView(transfer)); if (areAllRecipientsTerminal(transfer)) { outgoing.current.delete(transfer.id); updateTransfer(transfer.id, { file: undefined }) } }, [send, updateTransfer])
  const cancelTransfer = useCallback((recordId: string) => { const incomingTransfer = [...incoming.current.values()].find(value => value.recordId === recordId); if (incomingTransfer) { incoming.current.delete(incomingKey(incomingTransfer.peerId, incomingTransfer.offer.transferId)); void send({ v: 2, type: 'file-cancel', transferId: incomingTransfer.offer.transferId }, incomingTransfer.peerId); updateTransfer(recordId, { status: 'cancelled' }); return }; const transfer = outgoing.current.get(recordId); if (transfer) for (const peerId of transfer.recipients.keys()) cancelTransferForPeer(recordId, peerId) }, [cancelTransferForPeer, send, updateTransfer])
  const kickPeer = useCallback((peerId: string) => { if (!isCreator) return; const session = sessions.current.get(peerId); if (session) session.status = 'kicked'; endTransfersForKick(outgoing.current, peerId, updateTransfer); void send({ v: 2, type: 'kick-notice' }, peerId); setPeers(current => current.filter(peer => peer.id !== peerId)) }, [isCreator, send, updateTransfer])
  const admitPeer = useCallback((peerId: string) => admitPeerRef.current(peerId), [])
  const rename = useCallback((nextName: string) => { const previousName = nameRef.current; if (!nextName || nextName === previousName) return; nameRef.current = nextName; const event = { v: 2, type: 'system-event', id: uid(), event: 'nickname-changed', previousName, nextName, createdAt: Date.now() } as const; void send(event); addSystemEntry(event.id, `You changed your nickname to ${nextName}.`, event.createdAt); sendHelloRef.current() }, [addSystemEntry, send])
  const setFreeForAll = useCallback((enabled: boolean) => { if (!isCreator || enabled === freeForAllRef.current) return; freeForAllRef.current = enabled; setFreeForAllState(enabled); const event = { v: 2, type: 'system-event', id: uid(), event: 'setting-changed', setting: 'free-for-all', enabled, createdAt: Date.now() } as const; void send(event); addSystemEntry(event.id, `You changed the setting: Free for all ${enabled ? 'enabled' : 'disabled'}.`, event.createdAt) }, [addSystemEntry, isCreator, send])
  const startCanvas = useCallback(() => {
    if (canvasRef.current) return canvasRef.current.id
    const next: CanvasSession = { id: uid(), name: `${nameRef.current}'s Canvas`, starter: nameRef.current, createdAt: Date.now(), strokes: [], images: [] }
    setCanvas(next); setCanvasTraffic({ sent: 0, received: 0 }); setFeed(current => [{ id: `canvas:${next.id}`, kind: 'canvas', value: next.name, sender: 'You', createdAt: next.createdAt }, ...current])
    void canvasSendRef.current?.({ type: 'start', canvas: next })
    return next.id
  }, [])
  const joinCanvas = useCallback(() => { if (canvasRef.current) void canvasSendRef.current?.({ type: 'sync-request', canvasId: canvasRef.current.id }) }, [])
  const renameCanvas = useCallback((nextName: string) => {
    const current = canvasRef.current
    const name = nextName.trim().slice(0, 80)
    if (!current || current.starter !== nameRef.current || !name || name === current.name) return
    setCanvas({ ...current, name })
    setFeed(items => items.map(item => item.id === `canvas:${current.id}` ? { ...item, value: name } : item))
    void canvasSendRef.current?.({ type: 'rename', canvasId: current.id, name })
  }, [])
  const addCanvasStroke = useCallback((stroke: CanvasStroke, broadcast = true) => { const current = canvasRef.current; if (!current) return; const compacted = { ...stroke, points: stroke.points.map(point => compactPoint(point, dataSaverRef.current)) }; const index = current.strokes.findIndex(item => item.id === compacted.id); if (index < 0) setCanvas({ ...current, strokes: [...current.strokes, compacted] }); else if (current.strokes[index].points.length <= compacted.points.length) setCanvas({ ...current, strokes: current.strokes.map((item, candidate) => candidate === index ? compacted : item) }); if (broadcast) void canvasSendRef.current?.({ type: 'stroke', canvasId: current.id, stroke: compacted }) }, [])
  const startCanvasStroke = useCallback((stroke: CanvasStroke) => { const current = canvasRef.current; if (!current || !stroke.points.length || current.strokes.some(item => item.id === stroke.id)) return; const point = compactPoint(stroke.points[0], dataSaverRef.current), { points: _points, ...header } = stroke; setCanvas({ ...current, strokes: [...current.strokes, { ...stroke, points: [point] }] }); void canvasSendRef.current?.({ type: 'stroke-start', canvasId: current.id, stroke: header, point }) }, [])
  const appendCanvasStrokePoints = useCallback((id: string, points: CanvasPoint[]) => { const current = canvasRef.current; if (!current || !points.length) return; void canvasSendRef.current?.({ type: 'stroke-points', canvasId: current.id, id, points: compactPoints(points, dataSaverRef.current) }) }, [])
  const setCanvasDrawing = useCallback((point?: CanvasPoint) => { const current = canvasRef.current; if (!current) return; void canvasSendRef.current?.(point ? { type: 'drawing', canvasId: current.id, point: compactPoint(point, dataSaverRef.current) } : { type: 'drawing-stop', canvasId: current.id }) }, [])
  const addCanvasImage = useCallback((image: CanvasImage) => { const current = canvasRef.current; if (!current || current.images.some(item => item.id === image.id)) return; setCanvas({ ...current, images: [...current.images, image] }); void canvasSendRef.current?.({ type: 'image', canvasId: current.id, image }) }, [])
  const deleteCanvasElement = useCallback((id: string) => { const current = canvasRef.current; if (!current) return; setCanvas({ ...current, strokes: current.strokes.filter(stroke => stroke.id !== id), images: current.images.filter(image => image.id !== id) }); void canvasSendRef.current?.({ type: 'delete', canvasId: current.id, id }) }, [])
  return { state, passwordRequired, peers, pendingPeers, feed, transfers, typingPeers, hasConnected, sendItem, setTyping, offerFile, replyToOffer, cancelTransfer, cancelTransferForPeer, admitPeer, kickPeer, freeForAll, setFreeForAll, rename, retryConnection, canvas, canvasTraffic, canvasPresence, startCanvas, joinCanvas, renameCanvas, addCanvasStroke, startCanvasStroke, appendCanvasStrokePoints, setCanvasDrawing, addCanvasImage, deleteCanvasElement, getDiagnostics: async (): Promise<RtcDiagnostics[]> => roomRef.current ? getRoomDiagnostics(roomRef.current.getPeers()) : [] }
}

function endTransfersForKick(transfers: Map<string, OutgoingTransfer>, peerId: string, update: (id: string, change: Partial<TransferRecord>) => void) { for (const transfer of [...transfers.values()]) { const recipient = transfer.recipients.get(peerId); if (!recipient || isRecipientTerminal(recipient.status)) continue; recipient.abortController?.abort(); recipient.abortController = undefined; recipient.status = 'cancelled'; update(transfer.id, outgoingView(transfer)); if (areAllRecipientsTerminal(transfer)) { transfers.delete(transfer.id); update(transfer.id, { file: undefined }) } } }
async function sendFile({ id, file, peerId, sendChunk, sendControl, signal, report }: { id: string; file: File; peerId: string; sendChunk: (data: Uint8Array, peerId: string) => Promise<void>; sendControl: Sender<BeamMessage>; signal: AbortSignal; report: (bytesSent: number, metrics: { speed: number; averageSpeed: number; peakSpeed: number; elapsedMs: number }) => void }) { let offset = 0, index = 0, sent = 0, last = 0; const meter = createTransferMeter(); const prepared: Promise<{ body: Uint8Array; index: number } | null>[] = []; const prepare = async () => { if (signal.aborted || offset >= file.size) return null; const start = offset, chunkIndex = index; offset += CHUNK_SIZE; index += 1; return { body: new Uint8Array(await file.slice(start, Math.min(start + CHUNK_SIZE, file.size)).arrayBuffer()), index: chunkIndex } }; const fill = () => { while (prepared.length < PREPARED_CHUNK_COUNT && offset < file.size) prepared.push(prepare()) }; fill(); try { while (prepared.length) { const item = await prepared.shift(); if (!item || signal.aborted) return; await sendChunk(encodeChunk(id, item.index, item.body), peerId); sent += item.body.byteLength; fill(); const measurement = meter(sent), now = performance.now(); if (shouldReportProgress(last, now) || sent === file.size) { last = now; report(sent, measurement) } } if (!signal.aborted) await sendControl({ v: 2, type: 'file-complete', transferId: id }, peerId) } finally { await Promise.allSettled(prepared) } }
