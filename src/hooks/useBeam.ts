import { useCallback, useEffect, useRef, useState } from 'react'
import { joinRoom } from 'trystero/nostr'

import { roomIdFor } from '../lib/codes'
import {
  decryptBytes,
  decryptMessage,
  encryptionKeyFor,
  encryptBytes,
  encryptMessage,
  passwordProofFor,
} from '../lib/crypto'
import { inferDeviceType, type DeviceType } from '../lib/device'
import {
  CHUNK_SIZE,
  parseMessage,
  totalChunksFor,
  type BeamMessage,
  type FileOffer,
} from '../lib/protocol'
import { getRtcConfig } from '../lib/rtc'
import {
  getRoomDiagnostics,
  type RtcDiagnostics,
} from '../lib/rtcDiagnostics'
import {
  createTransferMeter,
  PREPARED_CHUNK_COUNT,
  shouldReportProgress,
} from '../lib/transfer'

export type ConnectionState =
  | 'idle'
  | 'waiting'
  | 'peer-found'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'password-required'
  | 'not-found'
  | 'kicked'
  | 'failed'

export type FeedItem = {
  id: string
  kind: 'text' | 'link' | 'file'
  value: string
  sender: string
  createdAt: number
  size?: number
  url?: string
  received?: boolean
  objectUrl?: string
}

export type TransferRecord = {
  id: string
  name: string
  size: number
  mimeType: string
  sender: string
  createdAt: number
  direction: 'sending' | 'receiving'
  status:
    | 'offered'
    | 'active'
    | 'complete'
    | 'declined'
    | 'cancelled'
    | 'interrupted'
  progress: number
  speed: number
  averageSpeed?: number
  peakSpeed?: number
  elapsedMs?: number
  file?: File
}

export type Peer = {
  id: string
  name: string
  deviceType: DeviceType
}

type Sender<T> = (
  data: T,
  peerId?: string,
) => void | Promise<void>

type RoomLike = {
  makeAction<T>(name: string): {
    send(data: T, options?: { target?: string }): Promise<void>
    onMessage: ((data: T, context: { peerId: string }) => void) | null
  }
  onPeerJoin: ((peerId: string) => void) | null
  onPeerLeave: ((peerId: string) => void) | null
  getPeers(): Record<string, RTCPeerConnection>
  leave(): Promise<void>
}

type IncomingFile = {
  offer: FileOffer
  chunks: Uint8Array[]
  bytes: number
  startedAt: number
  peerId: string
  meter?: ReturnType<typeof createTransferMeter>
  lastReportedAt?: number
}

type AccessMessage =
  | {
      type: 'probe'
    }
  | {
      type: 'status'
      locked: boolean
      passwordProof?: string
    }

const APP_ID = 'beamdrop-v1'
const CONTROL_ACTION = 'beam-control'
const CHUNK_ACTION = 'beam-chunk'
const ACCESS_ACTION = 'beam-access'

const MAX_PEER_NAME_LENGTH = 48
const NOT_FOUND_TIMEOUT = 8_000
const ACCESS_RETRY_DELAY = 300
const ACCESS_PROBE_INTERVAL = 750

function uid() {
  return (
    crypto.randomUUID?.() ??
    `${Date.now()}-${crypto.getRandomValues(new Uint32Array(1))[0]}`
  )
}

export function useBeam(
  secret: string | null,
  password: string,
  displayName: string,
  isCreator: boolean,
) {
  const [state, setState] = useState<ConnectionState>(
    secret ? 'waiting' : 'idle',
  )

  const [passwordRequired, setPasswordRequired] =
    useState(false)

  const [peers, setPeers] = useState<Peer[]>([])
  const [pendingPeers, setPendingPeers] = useState<Peer[]>(
    [],
  )
  const [feed, setFeed] = useState<FeedItem[]>([])
  const [transfers, setTransfers] = useState<
    TransferRecord[]
  >([])
  const [freeForAll, setFreeForAllState] =
    useState(false)

  const roomRef = useRef<RoomLike | null>(null)
  const keyRef = useRef<CryptoKey | null>(null)
  const controlSenderRef =
    useRef<Sender<Uint8Array> | null>(null)

  const incomingRef = useRef(
    new Map<string, IncomingFile>(),
  )
  const outgoingRef = useRef(new Map<string, File>())
  const cancelledRef = useRef(new Set<string>())
  const transferAbortersRef = useRef(
    new Map<string, AbortController>(),
  )

  const approvedRef = useRef(new Set<string>())
  const knownRef = useRef(new Map<string, Peer>())
  const tokensRef = useRef(new Map<string, string>())

  const ownTokenRef = useRef(uid())
  const joinedRef = useRef(isCreator)
  const passwordRef = useRef(password)
  const displayNameRef = useRef(displayName)
  const passwordProofRef = useRef('')
  const freeForAllRef = useRef(false)

  useEffect(() => {
    passwordRef.current = password
  }, [password])

  useEffect(() => {
    displayNameRef.current = displayName
  }, [displayName])

  const send = useCallback(
    async (
      message: BeamMessage,
      peerId?: string,
    ) => {
      const key = keyRef.current
      const sendControl = controlSenderRef.current

      if (!key || !sendControl) return

      const encrypted = await encryptMessage(
        key,
        message,
      )

      await sendControl(encrypted, peerId)
    },
    [],
  )

  useEffect(() => {
    if (!secret) return

    let cancelled = false

    const updateEncryption = async () => {
      const [key, proof] = await Promise.all([
        encryptionKeyFor(secret),
        passwordProofFor(secret, password),
      ])

      if (cancelled) return

      keyRef.current = key

      if (isCreator) {
        passwordProofRef.current = proof

        if (joinedRef.current) {
          await send({
            type: 'room-settings',
            passwordProof: proof,
            freeForAll: freeForAllRef.current,
          })
        }

        return
      }

      if (
        password &&
        roomRef.current &&
        !joinedRef.current
      ) {
        await send({
          type: 'join-request',
          name: displayNameRef.current,
          deviceType: inferDeviceType(),
          token: ownTokenRef.current,
          passwordProof: proof,
        })
      }
    }

    void updateEncryption()

    return () => {
      cancelled = true
    }
  }, [secret, password, isCreator, send])

  useEffect(() => {
    if (!secret) {
      setState('idle')
      return
    }

    let stopped = false
    let room: RoomLike | null = null
    let notFoundTimer: number | null = null

    const accessRetryTimers = new Set<number>()
    const accessProbeIntervals = new Map<
      string,
      number
    >()

    const clearNotFoundTimer = () => {
      if (notFoundTimer === null) return

      window.clearTimeout(notFoundTimer)
      notFoundTimer = null
    }

    const clearAccessProbe = (peerId: string) => {
      const interval =
        accessProbeIntervals.get(peerId)

      if (interval === undefined) return

      window.clearInterval(interval)
      accessProbeIntervals.delete(peerId)
    }

    const clearAllTimers = () => {
      clearNotFoundTimer()

      for (const timer of accessRetryTimers) {
        window.clearTimeout(timer)
      }

      accessRetryTimers.clear()

      for (const interval of accessProbeIntervals.values()) {
        window.clearInterval(interval)
      }

      accessProbeIntervals.clear()
    }

    const getPeerName = (peerId: string) =>
      knownRef.current.get(peerId)?.name ??
      'Connected device'

    const removePeer = (peerId: string) => {
      approvedRef.current.delete(peerId)
      knownRef.current.delete(peerId)
      tokensRef.current.delete(peerId)

      setPeers(current =>
        current.filter(peer => peer.id !== peerId),
      )

      setPendingPeers(current =>
        current.filter(peer => peer.id !== peerId),
      )
    }

    const addPeer = (peer: Peer) => {
      setPeers(current => {
        if (
          current.some(
            existing => existing.id === peer.id,
          )
        ) {
          return current
        }

        return [...current, peer]
      })
    }

    const addPendingPeer = (peer: Peer) => {
      setPendingPeers(current => {
        if (
          current.some(
            existing => existing.id === peer.id,
          )
        ) {
          return current
        }

        return [...current, peer]
      })
    }

    const updateTransfer = (
      id: string,
      update: Partial<TransferRecord>,
    ) => {
      setTransfers(current =>
        current.map(transfer =>
          transfer.id === id
            ? {
                ...transfer,
                ...update,
              }
            : transfer,
        ),
      )
    }

    const start = async () => {
      try {
        setPasswordRequired(false)
        setState('waiting')

        const [
          rtcConfig,
          roomId,
          key,
          initialProof,
        ] = await Promise.all([
          getRtcConfig(),
          roomIdFor(secret),
          encryptionKeyFor(secret),
          passwordProofFor(
            secret,
            passwordRef.current,
          ),
        ])

        if (stopped) return

        keyRef.current = key
        // Every member that can decrypt Beam control messages already has the
        // room password. Keep the locally derived proof from the start so a
        // new join request is not dropped while room settings are still in
        // transit. Previously only the creator set this value; an existing
        // guest could receive a third member's request before its access
        // status arrived and compare it against the initial empty string.
        passwordProofRef.current = initialProof
        joinedRef.current = isCreator

        room = joinRoom(
          {
            appId: APP_ID,
            rtcConfig,
          },
          roomId,
        ) as unknown as RoomLike

        roomRef.current = room

        const controlAction = room.makeAction<Uint8Array>(CONTROL_ACTION)
        const chunkAction = room.makeAction<Uint8Array>(CHUNK_ACTION)
        const accessAction = room.makeAction<AccessMessage>(ACCESS_ACTION)
        const sendControl: Sender<Uint8Array> = (data, peerId) =>
          controlAction.send(data, peerId ? { target: peerId } : undefined)
        const sendChunk: Sender<Uint8Array> = (data, peerId) =>
          chunkAction.send(data, peerId ? { target: peerId } : undefined)
        const sendAccess: Sender<AccessMessage> = (data, peerId) =>
          accessAction.send(data, peerId ? { target: peerId } : undefined)

        controlSenderRef.current = sendControl

        const transmit = (
          message: BeamMessage,
          peerId?: string,
        ) => send(message, peerId)

        const hello = (peerId?: string) => {
          void transmit(
            {
              type: 'hello',
              name: displayNameRef.current,
              deviceType: inferDeviceType(),
            },
            peerId,
          )
        }

        const approvePeer = (peerId: string) => {
          const token =
            tokensRef.current.get(peerId)

          if (!token) return

          approvedRef.current.add(peerId)

          setPendingPeers(current =>
            current.filter(
              peer => peer.id !== peerId,
            ),
          )

          void transmit({
            type: 'member-approved',
            peerId,
            token,
          })

          hello(peerId)
        }

        const announceAccess = (
          peerId: string,
        ) => {
          void sendAccess(
            {
              type: 'status',
              locked:
                passwordRef.current.length > 0,
              passwordProof:
                passwordProofRef.current,
            },
            peerId,
          )
        }

        const scheduleAccessRetry = (
          peerId: string,
        ) => {
          const timer = window.setTimeout(() => {
            accessRetryTimers.delete(timer)

            if (!stopped) {
              announceAccess(peerId)
            }
          }, ACCESS_RETRY_DELAY)

          accessRetryTimers.add(timer)
        }

        const startAccessProbe = (
          peerId: string,
        ) => {
          clearAccessProbe(peerId)

          const interval = window.setInterval(
            () => {
              if (
                stopped ||
                joinedRef.current
              ) {
                clearAccessProbe(peerId)
                return
              }

              void sendAccess(
                {
                  type: 'probe',
                },
                peerId,
              )
            },
            ACCESS_PROBE_INTERVAL,
          )

          accessProbeIntervals.set(
            peerId,
            interval,
          )
        }

        const handlePeerJoin = (
          peerId: string,
        ) => {
          setState(current =>
            current === 'waiting'
              ? 'peer-found'
              : current,
          )

          if (isCreator || joinedRef.current) {
            announceAccess(peerId)
            scheduleAccessRetry(peerId)
          }

          if (
            !isCreator &&
            !joinedRef.current
          ) {
            void sendAccess(
              {
                type: 'probe',
              },
              peerId,
            )

            startAccessProbe(peerId)

            void transmit(
              {
                type: 'join-request',
                name: displayNameRef.current,
                deviceType: inferDeviceType(),
                token: ownTokenRef.current,
                passwordProof: initialProof,
              },
              peerId,
            )
          }
        }

        const handlePeerLeave = (
          peerId: string,
        ) => {
          clearAccessProbe(peerId)
          removePeer(peerId)

          if (joinedRef.current) {
            setState('disconnected')
          }
        }

        const handleAccess = (
          message: AccessMessage,
          peerId: string,
        ) => {
          if (
            message.type === 'probe' &&
            (isCreator || joinedRef.current)
          ) {
            announceAccess(peerId)
            return
          }

          if (message.type !== 'status') return

          clearAccessProbe(peerId)

          if (message.passwordProof) {
            passwordProofRef.current =
              message.passwordProof
          }

          if (
            message.locked &&
            !passwordRef.current
          ) {
            clearNotFoundTimer()
            setPasswordRequired(true)
            setState('password-required')
          }
        }

        const handleJoinRequest = (
          message: Extract<
            BeamMessage,
            { type: 'join-request' }
          >,
          peerId: string,
        ) => {
          if (
            message.passwordProof !==
            passwordProofRef.current
          ) {
            return
          }

          const candidate: Peer = {
            id: peerId,
            name: message.name.slice(
              0,
              MAX_PEER_NAME_LENGTH,
            ),
            deviceType: message.deviceType,
          }

          knownRef.current.set(
            peerId,
            candidate,
          )

          tokensRef.current.set(
            peerId,
            message.token,
          )

          const shouldAutoApprove =
            (isCreator &&
              approvedRef.current.size === 0) ||
            freeForAllRef.current

          if (shouldAutoApprove) {
            approvePeer(peerId)
            return
          }

          if (
            joinedRef.current &&
            !approvedRef.current.has(peerId)
          ) {
            addPendingPeer(candidate)
          }
        }

        const handleMemberApproved = (
          message: Extract<
            BeamMessage,
            { type: 'member-approved' }
          >,
          peerId: string,
        ) => {
          setPendingPeers(current =>
            current.filter(
              peer => peer.id !== message.peerId,
            ),
          )

          if (
            !joinedRef.current &&
            message.token === ownTokenRef.current
          ) {
            approvedRef.current.add(peerId)
            joinedRef.current = true

            clearNotFoundTimer()

            setState('connected')
            hello(peerId)

            return
          }

          if (
            joinedRef.current &&
            approvedRef.current.has(peerId)
          ) {
            approvedRef.current.add(
              message.peerId,
            )

            void transmit(
              {
                type: 'member-introduction',
                token: message.token,
              },
              message.peerId,
            )

            hello(message.peerId)
          }
        }

        const handleMemberIntroduction = (
          message: Extract<
            BeamMessage,
            { type: 'member-introduction' }
          >,
          peerId: string,
        ) => {
          if (
            !joinedRef.current ||
            message.token !== ownTokenRef.current
          ) {
            return
          }

          approvedRef.current.add(peerId)
          hello(peerId)
        }

        const handleHello = (
          message: Extract<
            BeamMessage,
            { type: 'hello' }
          >,
          peerId: string,
        ) => {
          const peer: Peer = {
            id: peerId,
            name: message.name.slice(
              0,
              MAX_PEER_NAME_LENGTH,
            ),
            deviceType: message.deviceType,
          }

          knownRef.current.set(peerId, peer)
          addPeer(peer)

          setState('connected')
          hello(peerId)
        }

        const handleItem = (
          message: Extract<
            BeamMessage,
            { type: 'item' }
          >,
          peerId: string,
        ) => {
          const item = message.item

          setFeed(current => [
            {
              id: item.id,
              kind: item.kind,
              value: item.value,
              url:
                item.kind === 'link'
                  ? item.value
                  : undefined,
              sender: getPeerName(peerId),
              createdAt: item.createdAt,
              received: true,
            },
            ...current,
          ])
        }

        const handleFileOffer = (
          message: Extract<
            BeamMessage,
            { type: 'file-offer' }
          >,
          peerId: string,
        ) => {
          incomingRef.current.set(
            message.transferId,
            {
              offer: message,
              chunks: [],
              bytes: 0,
              startedAt: Date.now(),
              peerId,
            },
          )

          setTransfers(current => [
            {
              id: message.transferId,
              name: message.name,
              size: message.size,
              mimeType: message.mimeType,
              sender: getPeerName(peerId),
              createdAt: Date.now(),
              direction: 'receiving',
              status: 'offered',
              progress: 0,
              speed: 0,
            },
            ...current,
          ])
        }

        const handleFileAccept = (
          message: Extract<
            BeamMessage,
            { type: 'file-accept' }
          >,
          peerId: string,
        ) => {
          const file =
            outgoingRef.current.get(
              message.transferId,
            )

          if (!file) return

          const controller = new AbortController()
          transferAbortersRef.current.set(
            message.transferId,
            controller,
          )

          updateTransfer(message.transferId, { status: 'active' })

          void sendFileChunks({
            id: message.transferId,
            file,
            peerId,
            sendChunk,
            sendControl: transmit,
            key: keyRef.current ?? key,
            isCancelled: id =>
              cancelledRef.current.has(id),
            signal: controller.signal,
            report: (progress, speed, metrics) => {
              updateTransfer(
                message.transferId,
                {
                  status: 'active',
                  progress,
                  speed,
                  averageSpeed: metrics?.averageSpeed,
                  peakSpeed: metrics?.peakSpeed,
                  elapsedMs: metrics?.elapsedMs,
                },
              )
            },
          })
            .catch(() => {
              if (!cancelledRef.current.has(message.transferId)) {
                updateTransfer(message.transferId, { status: 'interrupted' })
              }
            })
            .finally(() => {
              transferAbortersRef.current.delete(message.transferId)
            })
        }

        const handleControl = async (
          raw: Uint8Array,
          peerId: string,
        ) => {
          const decrypted =
            await decryptMessage(
              keyRef.current ?? key,
              raw,
            )

          const message =
            parseMessage(decrypted)

          if (!message || stopped) return

          switch (message.type) {
            case 'join-request':
              handleJoinRequest(
                message,
                peerId,
              )
              return

            case 'room-settings':
              passwordProofRef.current =
                message.passwordProof

              freeForAllRef.current =
                message.freeForAll

              setFreeForAllState(
                message.freeForAll,
              )
              return

            case 'member-approved':
              handleMemberApproved(
                message,
                peerId,
              )
              return

            case 'member-introduction':
              handleMemberIntroduction(
                message,
                peerId,
              )
              return

            case 'member-kicked':
              approvedRef.current.delete(
                message.peerId,
              )

              setPeers(current =>
                current.filter(
                  peer =>
                    peer.id !==
                    message.peerId,
                ),
              )
              return

            case 'kick-notice':
              setState('kicked')
              room?.leave()
              return
          }

          if (
            !approvedRef.current.has(peerId)
          ) {
            return
          }

          switch (message.type) {
            case 'hello':
              handleHello(message, peerId)
              break

            case 'item':
              handleItem(message, peerId)
              break

            case 'file-offer':
              handleFileOffer(
                message,
                peerId,
              )
              break

            case 'file-accept':
              handleFileAccept(
                message,
                peerId,
              )
              break

            case 'file-decline':
              updateTransfer(
                message.transferId,
                {
                  status: 'declined',
                },
              )
              break

            case 'file-cancel':
              updateTransfer(
                message.transferId,
                {
                  status: 'cancelled',
                },
              )
              break

            case 'file-complete':
              outgoingRef.current.delete(message.transferId)
              updateTransfer(
                message.transferId,
                {
                  status: 'complete',
                  progress: 1,
                },
              )
              break
          }
        }

        const handleChunk = async (
          raw: Uint8Array,
          peerId: string,
        ) => {
          if (
            !approvedRef.current.has(peerId)
          ) {
            return
          }

          const data = await decryptBytes(
            keyRef.current ?? key,
            raw,
          )

          if (!data) return

          const [id, index, bytes] =
            decodeChunk(data)

          const incoming =
            incomingRef.current.get(id)

          if (!incoming) return
          if (incoming.peerId !== peerId) return
          if (
            index !== incoming.chunks.length
          ) {
            return
          }

          incoming.chunks.push(bytes)
          incoming.bytes += bytes.byteLength

          const meter = incoming.meter ??= createTransferMeter()
          const measurement = meter(incoming.bytes)
          const now = performance.now()

          if (
            shouldReportProgress(incoming.lastReportedAt ?? 0, now) ||
            incoming.bytes >= incoming.offer.size
          ) {
            incoming.lastReportedAt = now
            updateTransfer(id, {
              status: 'active',
              progress: incoming.bytes / incoming.offer.size,
              speed: measurement.speed,
              averageSpeed: measurement.averageSpeed,
              peakSpeed: measurement.peakSpeed,
              elapsedMs: measurement.elapsedMs,
            })
          }

          if (
            incoming.bytes <
            incoming.offer.size
          ) {
            return
          }

          const blob = new Blob(
            incoming.chunks,
            {
              type: incoming.offer.mimeType,
            },
          )

          const objectUrl =
            URL.createObjectURL(blob)

          updateTransfer(id, {
            status: 'complete',
            progress: 1,
          })

          setFeed(current => [
            {
              id,
              kind: 'file',
              value: incoming.offer.name,
              size: incoming.offer.size,
              sender: getPeerName(peerId),
              createdAt: Date.now(),
              received: true,
              objectUrl,
            },
            ...current,
          ])

          incomingRef.current.delete(id)

          void transmit(
            {
              type: 'file-complete',
              transferId: id,
            },
            peerId,
          )
        }

        room.onPeerJoin = handlePeerJoin
        room.onPeerLeave = handlePeerLeave
        accessAction.onMessage = (message, { peerId }) =>
          handleAccess(message, peerId)
        controlAction.onMessage = (raw, { peerId }) => {
          void handleControl(raw, peerId)
        }
        chunkAction.onMessage = (raw, { peerId }) => {
          void handleChunk(raw, peerId)
        }

        if (!isCreator) {
          notFoundTimer =
            window.setTimeout(() => {
              if (joinedRef.current) return

              room?.leave()
              setState('not-found')
            }, NOT_FOUND_TIMEOUT)
        }
      } catch {
        setState('failed')
      }
    }

    void start()

    return () => {
      stopped = true

      clearAllTimers()

      room?.leave()

      roomRef.current = null
      keyRef.current = null
      controlSenderRef.current = null

      incomingRef.current.forEach(file => {
        file.chunks.length = 0
      })
      transferAbortersRef.current.forEach(controller => controller.abort())
      transferAbortersRef.current.clear()
    }
  }, [secret, isCreator, send])

  const sendItem = useCallback(
    (
      value: string,
      kind: 'text' | 'link',
    ) => {
      const trimmedValue = value.trim()

      if (
        !trimmedValue ||
        !joinedRef.current
      ) {
        return
      }

      const item = {
        id: uid(),
        kind,
        value: trimmedValue,
        createdAt: Date.now(),
      } as const

      void send({
        type: 'item',
        item,
      })

      setFeed(current => [
        {
          id: item.id,
          kind,
          value: item.value,
          sender: 'You',
          createdAt: item.createdAt,
        },
        ...current,
      ])
    },
    [send],
  )

  const offerFile = useCallback(
    (file: File) => {
      if (!joinedRef.current) return

      const id = uid()

      const offer: FileOffer = {
        type: 'file-offer',
        transferId: id,
        name: file.name,
        size: file.size,
        mimeType:
          file.type ||
          'application/octet-stream',
        totalChunks: totalChunksFor(
          file.size,
        ),
      }

      outgoingRef.current.set(id, file)

      void send(offer)

      setTransfers(current => [
        {
          id,
          name: file.name,
          size: file.size,
          mimeType: offer.mimeType,
          sender: 'You',
          createdAt: Date.now(),
          direction: 'sending',
          status: 'offered',
          progress: 0,
          speed: 0,
          file,
        },
        ...current,
      ])
    },
    [send],
  )

  const replyToOffer = useCallback(
    (id: string, accept: boolean) => {
      const incoming =
        incomingRef.current.get(id)

      if (!incoming) return

      void send(
        {
          type: accept
            ? 'file-accept'
            : 'file-decline',
          transferId: id,
        },
        incoming.peerId,
      )

      setTransfers(current =>
        current.map(transfer =>
          transfer.id === id
            ? {
                ...transfer,
                status: accept
                  ? 'active'
                  : 'declined',
              }
            : transfer,
        ),
      )
    },
    [send],
  )

  const cancelTransfer = useCallback(
    (id: string) => {
      cancelledRef.current.add(id)
      transferAbortersRef.current.get(id)?.abort()
      transferAbortersRef.current.delete(id)

      void send({
        type: 'file-cancel',
        transferId: id,
      })

      outgoingRef.current.delete(id)
      incomingRef.current.delete(id)

      setTransfers(current =>
        current.map(transfer =>
          transfer.id === id
            ? {
                ...transfer,
                status: 'cancelled',
              }
            : transfer,
        ),
      )
    },
    [send],
  )

  const admitPeer = useCallback(
    (peerId: string) => {
      const token =
        tokensRef.current.get(peerId)

      if (!token) return

      approvedRef.current.add(peerId)

      setPendingPeers(current =>
        current.filter(
          peer => peer.id !== peerId,
        ),
      )

      void send({
        type: 'member-approved',
        peerId,
        token,
      })
    },
    [send],
  )

  const kickPeer = useCallback(
    (peerId: string) => {
      approvedRef.current.delete(peerId)

      setPeers(current =>
        current.filter(
          peer => peer.id !== peerId,
        ),
      )

      void send({
        type: 'member-kicked',
        peerId,
      })

      void send(
        {
          type: 'kick-notice',
        },
        peerId,
      )
    },
    [send],
  )

  const setFreeForAll = useCallback(
    (enabled: boolean) => {
      if (!isCreator) return

      freeForAllRef.current = enabled
      setFreeForAllState(enabled)

      void send({
        type: 'room-settings',
        passwordProof:
          passwordProofRef.current,
        freeForAll: enabled,
      })
    },
    [isCreator, send],
  )

  return {
    state,
    passwordRequired,
    peers,
    pendingPeers,
    feed,
    transfers,
    sendItem,
    offerFile,
    replyToOffer,
    cancelTransfer,
    admitPeer,
    kickPeer,
    freeForAll,
    setFreeForAll,
    getDiagnostics: async (): Promise<RtcDiagnostics[]> =>
      roomRef.current
        ? getRoomDiagnostics(roomRef.current.getPeers())
        : [],
  }
}

type SendFileChunksOptions = {
  id: string
  file: File
  peerId: string
  sendChunk: Sender<Uint8Array>
  sendControl: (
    message: BeamMessage,
    peerId?: string,
  ) => Promise<void>
  key: CryptoKey
  isCancelled: (id: string) => boolean
  signal: AbortSignal
  report: (
    progress: number,
    speed: number,
    metrics?: {
      averageSpeed: number
      peakSpeed: number
      elapsedMs: number
    },
  ) => void
}

async function sendFileChunks({
  id,
  file,
  peerId,
  sendChunk,
  sendControl,
  key,
  isCancelled,
  signal,
  report,
}: SendFileChunksOptions) {
  type PreparedChunk = {
    encrypted: Uint8Array
    byteLength: number
  }

  let nextOffset = 0
  let nextIndex = 0
  const meter = createTransferMeter()
  let lastReportedAt = 0

  const prepare = async (): Promise<PreparedChunk | null> => {
    if (signal.aborted || isCancelled(id) || nextOffset >= file.size) {
      return null
    }

    const offset = nextOffset
    const index = nextIndex
    nextOffset += CHUNK_SIZE
    nextIndex += 1

    const body = new Uint8Array(await file
      .slice(offset, Math.min(offset + CHUNK_SIZE, file.size))
      .arrayBuffer())
    if (signal.aborted || isCancelled(id)) return null

    return {
      encrypted: await encryptBytes(key, encodeChunk(id, index, body)),
      byteLength: body.byteLength,
    }
  }

  // Keep a small, fixed amount of disk I/O and WebCrypto work ahead of the
  // network sender. This is deliberately bounded for multi-gigabyte files.
  const prepared: Promise<PreparedChunk | null>[] = []
  const fillPrepared = () => {
    while (prepared.length < PREPARED_CHUNK_COUNT && nextOffset < file.size) {
      prepared.push(prepare())
    }
  }

  let sentBytes = 0
  try {
    fillPrepared()
    while (prepared.length > 0) {
      // Await in file order even if a later encryption operation completes
      // first: the receiver intentionally rejects out-of-order chunks.
      const item = await prepared.shift()!
      if (!item || signal.aborted || isCancelled(id)) return

      // Trystero 0.25 performs conservative, event-driven DataChannel
      // backpressure internally. Awaiting this preserves action ordering while
      // its queue stays full through each 64 KiB Beam chunk.
      await sendChunk(item.encrypted, peerId)
      sentBytes += item.byteLength
      fillPrepared()

      const measurement = meter(sentBytes)
      const now = performance.now()
      if (
        shouldReportProgress(lastReportedAt, now) ||
        sentBytes >= file.size
      ) {
        lastReportedAt = now
        report(sentBytes / file.size, measurement.speed, measurement)
      }
    }

    if (signal.aborted || isCancelled(id)) return

    await sendControl({ type: 'file-complete', transferId: id }, peerId)
    const finalMeasurement = meter(file.size)
    report(1, finalMeasurement.speed, finalMeasurement)
    if (import.meta.env.DEV) {
      console.info('Beam transfer complete', {
        size: file.size,
        durationMs: Math.round(finalMeasurement.elapsedMs),
        averageBytesPerSecond: Math.round(finalMeasurement.averageSpeed),
        peakBytesPerSecond: Math.round(finalMeasurement.peakSpeed),
      })
    }
  } finally {
    // A cancelled transfer can still have a few WebCrypto operations in flight.
    // Observe them before dropping the bounded queue so rejected promises never
    // become unhandled rejections.
    await Promise.allSettled(prepared)
    prepared.length = 0
  }
}

function encodeChunk(
  id: string,
  index: number,
  body: Uint8Array,
) {
  const header = new TextEncoder().encode(
    `${id}:${index}:`,
  )

  const result = new Uint8Array(
    header.length + body.length,
  )

  result.set(header)
  result.set(body, header.length)

  return result
}

function decodeChunk(
  data: Uint8Array,
): [string, number, Uint8Array] {
  const firstSeparator = data.indexOf(58)
  const secondSeparator = data.indexOf(
    58,
    firstSeparator + 1,
  )

  const decoder = new TextDecoder()

  const id = decoder.decode(
    data.subarray(0, firstSeparator),
  )

  const index = Number(
    decoder.decode(
    data.subarray(
        firstSeparator + 1,
        secondSeparator,
      ),
    ),
  )

  const body = data.subarray(
    secondSeparator + 1,
  )

  return [id, index, body]
}
