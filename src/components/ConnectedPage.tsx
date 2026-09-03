import { AnimatePresence, motion } from 'framer-motion'
import { Activity, ArrowDown, ArrowUp, Check, ChevronDown, Clipboard, Clock3, Copy, Download, Eye, EyeOff, FileText, Gamepad2, Gauge, LoaderCircle, LockKeyhole, LogOut, MapPin, Network, Paintbrush, Plus, RefreshCw, Send, Settings, UserRound, UserRoundX, WifiOff, X } from 'lucide-react'
import { type ComponentType, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CircleMarker, MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

import { formatBytes, hostnameFor, isUrl } from '../lib/format'
import { isPotentiallyDangerousFile } from '../lib/dangerousFile'
import { connectionHealth } from '../lib/rtcDiagnostics'
import { useBeam, type FeedItem, type TransferRecord } from '../hooks/useBeam'
import type { RtcDiagnostics } from '../lib/rtcDiagnostics'
import { WaitingPage } from './WaitingPage'
import { CanvasBoard } from './CanvasBoard'

const PASSWORD_FEATURE_ENABLED = false

const gameLauncherGames: {
  id: string
  title: string
  genre: string
  players: string
  summary: string
}[] = [
  { id: 'dungeon-raid', title: 'Delvebound', genre: 'Asynchronous dungeon tactics', players: '2–4 players', summary: 'Build a party route and choose abilities, then regroup between batches of encounters to adapt your plan.' },
  { id: 'heist-planner', title: 'The Quiet Job', genre: 'Co-op heist planning', players: '3–5 players', summary: 'Assign specialist roles, map routes, and pack gadgets together before each heist stage resolves.' },
  { id: 'territory-control', title: 'Crownlines', genre: 'Simultaneous map control', players: '2–6 players', summary: 'Issue simultaneous orders, negotiate alliances, and spend shared resources to expand across the map.' },
  { id: 'trivia-bluffing', title: 'Plausible', genre: 'Trivia and bluffing', players: '3–8 players', summary: 'Submit a believable answer, spot the most convincing fakes, and earn points for fooling the room.' },
  { id: 'social-deduction', title: 'The Last Alibi', genre: 'Social deduction', players: '5–10 players', summary: 'Gather evidence, compare stories, and make the case before the group’s next periodic vote.' },
  { id: 'creature-battler', title: 'Wildlink', genre: 'Creature-card duels', players: '2 players', summary: 'Draft a deck, take deliberate turns, and chain creature abilities into powerful combinations.' },
  { id: 'city-builder', title: 'Common Ground', genre: 'Collaborative city building', players: '2–6 players', summary: 'Contribute resources and place districts in shared build rounds while responding to changing events.' },
  { id: 'racing-manager', title: 'Apex Tactics', genre: 'Racing management', players: '2–8 players', summary: 'Set race strategy, pit decisions, and upgrades before each simulation checkpoint.' },
  { id: 'art-relay', title: 'Telephone Ink', genre: 'Art and word relay', players: '3–8 players', summary: 'Draw, caption, reinterpret, and reveal the wildly unexpected chain your group created.' },
  { id: 'escape-room', title: 'The Locked Annex', genre: 'Escape-room co-op', players: '2–6 players', summary: 'Pool clues, inspect inventory, and solve a shared sequence of puzzles at your own pace.' },
  { id: 'prediction-market', title: 'Forecast Floor', genre: 'Prediction market', players: '3–8 players', summary: 'Forecast in-game outcomes and player choices, then trade on your predictions as each round resolves.' },
]

function GameArtwork({ gameId }: { gameId: string }) {
  const art = (() => {
    switch (gameId) {
      case 'dungeon-raid': return <><rect width="160" height="112" fill="#12182a"/><path d="M12 100 53 23 82 60l27-45 39 85Z" fill="#283a67"/><path d="m70 93 19-58 15 13-20 53Z" fill="#f4be5f"/><path d="m88 36 14 12-30 48-13-12Z" fill="#e8e2d1"/><circle cx="132" cy="27" r="11" fill="#f6c862"/><path d="M24 31h23M24 39h33M25 47h19" stroke="#6b84be" strokeWidth="3" strokeLinecap="round"/></>
      case 'heist-planner': return <><rect width="160" height="112" fill="#0d2631"/><path d="M0 16h160M0 48h160M0 80h160M31 0v112M77 0v112M122 0v112" stroke="#2f7581" strokeWidth="2"/><path d="M14 89c30-38 37-5 61-45 19-31 29-11 56-50" fill="none" stroke="#f06051" strokeWidth="5" strokeDasharray="8 5"/><rect x="93" y="53" width="42" height="31" rx="4" fill="#f0b14a"/><path d="M101 53v-7c0-12 25-12 25 0v7" fill="none" stroke="#f0b14a" strokeWidth="5"/><circle cx="34" cy="26" r="8" fill="#d7f1e9"/></>
      case 'territory-control': return <><rect width="160" height="112" fill="#173938"/><path d="M0 22 36 7l29 17 36-15 24 18 35-6v91H0Z" fill="#b8bb73"/><path d="M11 70 44 55l31 15 32-27 42 15" fill="none" stroke="#3f6856" strokeWidth="5"/><path d="m60 47 10-17 10 17 14 4-10 12 2 17-16-8-16 8 2-17-10-12Z" fill="#f5d774"/><circle cx="24" cy="35" r="8" fill="#e86a50"/><circle cx="121" cy="79" r="8" fill="#5873c4"/></>
      case 'trivia-bluffing': return <><rect width="160" height="112" fill="#4f2858"/><path d="M0 90 39 35l34 32 39-49 48 72v22H0Z" fill="#7c4c8d"/><circle cx="82" cy="50" r="31" fill="#f5cf63"/><path d="M73 43c4-14 25-9 24 4 0 12-13 12-13 21M84 78v1" fill="none" stroke="#54285e" strokeWidth="8" strokeLinecap="round"/><path d="m17 27 21 13M124 22l19 16" stroke="#f3a3c5" strokeWidth="5" strokeLinecap="round"/></>
      case 'social-deduction': return <><rect width="160" height="112" fill="#302635"/><path d="M20 20h47v36H20zM92 14h48v31H92zM75 67h52v31H75z" fill="#efe3c8"/><path d="M35 34 111 29 100 79 56 40" fill="none" stroke="#d75958" strokeWidth="3"/><path d="M26 74c13-20 32-21 45 0" fill="#211b28"/><circle cx="49" cy="58" r="15" fill="#e8a65e"/><path d="M45 57h9M49 52v10" stroke="#302635" strokeWidth="3"/><path d="M130 61l14 9" stroke="#f0b256" strokeWidth="4"/></>
      case 'creature-battler': return <><rect width="160" height="112" fill="#152d4a"/><path d="M19 97c10-54 31-73 61-73 36 0 54 27 61 73" fill="#4f9c9c"/><path d="M48 36 67 22l7 18 14-18 20 17-10 46H57Z" fill="#e98163"/><circle cx="66" cy="60" r="8" fill="#18253c"/><circle cx="94" cy="60" r="8" fill="#18253c"/><path d="M68 80q13 11 26 0" fill="none" stroke="#18253c" strokeWidth="5" strokeLinecap="round"/><path d="m129 25 7 13 15 3-11 11 3 15-14-7-13 7 2-15-11-11 15-3Z" fill="#f4cf65"/></>
      case 'city-builder': return <><rect width="160" height="112" fill="#4f7a9f"/><path d="M0 84h160v28H0z" fill="#d9bd7d"/><path d="M18 84V42h26v42M48 84V26h31v58M84 84V49h20v35M109 84V35h32v49" fill="#f4e8c7"/><path d="M25 51h6m8 0h-6m-8 12h6m8 0h-6m17-25h8m5 0h-8m-5 14h8m5 0h-8m-5 14h8m5 0h-8m38-21h7m5 0h-7m-5 13h7m5 0h-7m19-25h9m5 0h-9m-5 15h9m5 0h-9m-5 15h9m5 0h-9" stroke="#4f7a9f" strokeWidth="4"/><path d="M7 92h146" stroke="#5a835f" strokeWidth="7"/></>
      case 'racing-manager': return <><rect width="160" height="112" fill="#e7d9c4"/><path d="M20 99c39-2 22-56 66-59 38-3 21 47 58 38" fill="none" stroke="#202a36" strokeWidth="22" strokeLinecap="round"/><path d="M20 99c39-2 22-56 66-59 38-3 21 47 58 38" fill="none" stroke="#f3f1e6" strokeWidth="3" strokeDasharray="8 7"/><path d="M110 15h34v27h-34z" fill="#f25d4b"/><path d="M110 15h17v27h-17z" fill="#f5d76a"/><path d="M39 42h17l8 11-8 11H39l-8-11z" fill="#426bd1"/></>
      case 'art-relay': return <><rect width="160" height="112" fill="#fff7e8"/><path d="m17 84 20-48 29 16-19 45Z" fill="#f4c75d"/><path d="m38 29 11-18 11 8-10 19Z" fill="#363c5a"/><path d="M79 22c31 3 28 30 49 30 15 0 18-12 18-22" fill="none" stroke="#dc5e75" strokeWidth="7" strokeLinecap="round"/><path d="M75 77c31-2 30-31 52-30 12 0 17 10 18 18" fill="none" stroke="#4a88b5" strokeWidth="6" strokeLinecap="round"/><path d="m95 70 16 21 10-25 15 22" fill="none" stroke="#64a86e" strokeWidth="5"/></>
      case 'escape-room': return <><rect width="160" height="112" fill="#24303e"/><path d="M41 11h76v101H41z" fill="#975944"/><path d="M51 21h56v91H51z" fill="#683d35"/><circle cx="96" cy="66" r="5" fill="#f4c96c"/><path d="M20 97c22-16 20-42 20-64M140 97c-22-16-20-42-20-64" fill="none" stroke="#b7c6bb" strokeWidth="4"/><circle cx="28" cy="27" r="16" fill="#eef0df"/><path d="M28 19v17m-7-8h14" stroke="#5b6a68" strokeWidth="3"/><path d="M78 25c10-9 22-8 31 0" fill="none" stroke="#f0d1a6" strokeWidth="4"/></>
      default: return <><rect width="160" height="112" fill="#123b48"/><path d="M0 77h160v35H0z" fill="#1d5963"/><path d="M15 81 44 56l27 13 30-37 43 46" fill="none" stroke="#f6c75e" strokeWidth="5"/><path d="M23 27h24v32H23zM59 42h24v17H59zM95 19h24v40H95z" fill="#dce6d3"/><path d="M0 93h160" stroke="#dce6d3" strokeWidth="2" strokeDasharray="7 6"/></>
    }
  })()

  return <svg viewBox="0 0 160 112" preserveAspectRatio="xMidYMid slice" focusable="false">{art}</svg>
}

export function ConnectedPage({
  secret,
  password,
  isCreator,
  displayName,
  quickStartCanvas,
  onRename,
  onEnd,
  onPasswordChange,
}: {
  secret: string
  password: string
  isCreator: boolean
  displayName: string
  quickStartCanvas: boolean
  onRename(name: string): void
  onEnd(): void
  onPasswordChange(password: string): void
}) {
  const [dataSaver, setDataSaver] = useState(() => localStorage.getItem('beam-data-saver') === 'true')
  const beam = useBeam(secret, password, displayName, isCreator, dataSaver)

  const [qrOpen, setQrOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [dataSaverWarningOpen, setDataSaverWarningOpen] = useState(false)
  const [roomCodeVisible, setRoomCodeVisible] = useState(false)
  const [metricsOpen, setMetricsOpen] = useState(false)
  const [diagnostics, setDiagnostics] = useState<RtcDiagnostics[]>([])
  const [diagnosticsUpdatedAt, setDiagnosticsUpdatedAt] = useState<number | null>(null)
  const [passwordDraft, setPasswordDraft] = useState('')
  const [nameDraft, setNameDraft] = useState(displayName)
  const [copied, setCopied] = useState(false)
  const [composer, setComposer] = useState('')
  const [attachmentsOpen, setAttachmentsOpen] = useState(false)
  const [participantsExpanded, setParticipantsExpanded] = useState(false)
  const [pendingDangerousFile, setPendingDangerousFile] = useState<TransferRecord | null>(null)
  const [pendingDataFiles, setPendingDataFiles] = useState<File[] | null>(null)
  const [pendingDataReceive, setPendingDataReceive] = useState<TransferRecord | null>(null)
  const [canvasOpen, setCanvasOpen] = useState(false)
  const [canvasWarning, setCanvasWarning] = useState<'start' | 'join' | null>(null)
  const [gamesOpen, setGamesOpen] = useState(false)
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null)
  const [compactCanvasViewport, setCompactCanvasViewport] = useState(false)

  const [composerMode, setComposerMode] = useState<
    'text' | 'location'
  >('text')

  const [shareStatus, setShareStatus] = useState('')

  const [pickedLocation, setPickedLocation] = useState<{
    lat: number
    lng: number
  } | null>(null)

  const fileInput = useRef<HTMLInputElement>(null)
  const composerInput = useRef<HTMLTextAreaElement>(null)
  const attachmentActionsRef = useRef<HTMLDivElement>(null)
  const conversationRef = useRef<HTMLElement>(null)
  const dangerousFileDialogRef = useRef<HTMLElement>(null)
  const dangerousFileTriggerRef = useRef<HTMLElement | null>(null)
  const metricsDialogRef = useRef<HTMLElement>(null)
  const metricsTriggerRef = useRef<HTMLElement | null>(null)
  const gamesDialogRef = useRef<HTMLElement>(null)
  const gamesTriggerRef = useRef<HTMLElement | null>(null)
  const quickStartCanvasHandled = useRef(false)
  const connected = beam.state === 'connected'
  const health = connectionHealth(diagnostics)
  const canvasConditions = [
    compactCanvasViewport
      ? 'This screen is compact. Canvas works here, but a larger screen gives you more room to draw and navigate.'
      : null,
    beam.peers.length + 1 > 4
      ? 'More than four people are in this Beam. Canvas updates may feel less responsive.'
      : null,
    health.tone !== 'good'
      ? `${health.label}. Canvas is best on a stable, direct connection.`
      : null,
  ].filter((condition): condition is string => Boolean(condition))
  const activityCount =
    beam.feed.length +
    beam.transfers.length +
    beam.pendingPeers.length

  useLayoutEffect(() => {
    if (connected && conversationRef.current) {
      conversationRef.current.scrollTop =
        conversationRef.current.scrollHeight
    }
  }, [activityCount, connected])

  useEffect(() => {
    if (composerInput.current) {
      resizeComposer(composerInput.current)
    }
  }, [composer])

  useEffect(() => {
    setNameDraft(displayName)
  }, [displayName])

  useEffect(() => {
    const query = window.matchMedia('(max-width: 720px), (max-height: 560px)')
    const updateViewport = () => setCompactCanvasViewport(query.matches)
    updateViewport()
    query.addEventListener('change', updateViewport)
    return () => query.removeEventListener('change', updateViewport)
  }, [])

  useEffect(() => {
    if (!quickStartCanvas || !connected || quickStartCanvasHandled.current) return

    if (isCreator) {
      beam.startCanvas()
      setCanvasOpen(true)
      quickStartCanvasHandled.current = true
      return
    }

    if (beam.canvas) {
      beam.joinCanvas()
      setCanvasOpen(true)
      quickStartCanvasHandled.current = true
    }
  }, [beam.canvas, beam.joinCanvas, beam.startCanvas, connected, isCreator, quickStartCanvas])

  useEffect(() => {
    if (!attachmentsOpen) return

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!attachmentActionsRef.current?.contains(event.target as Node)) {
        setAttachmentsOpen(false)
      }
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAttachmentsOpen(false)
    }

    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [attachmentsOpen])

  useEffect(() => {
    if (!metricsOpen && !connected) return

    let active = true
    const refresh = async () => {
      const next = await beam.getDiagnostics(metricsOpen)
      if (!active) return
      setDiagnostics(next)
      setDiagnosticsUpdatedAt(Date.now())
    }

    void refresh()
    const interval = window.setInterval(
      () => void refresh(),
      metricsOpen ? 2_000 : 5_000,
    )
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [connected, metricsOpen])

  useEffect(() => {
    if (!pendingDangerousFile) return

    const dialog = dangerousFileDialogRef.current
    const previousFocus = dangerousFileTriggerRef.current
    const focusable = () => dialog
      ? [...dialog.querySelectorAll<HTMLElement>('button:not([disabled])')]
      : []

    requestAnimationFrame(() => focusable()[0]?.focus())

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setPendingDangerousFile(null)
        return
      }

      if (event.key !== 'Tab') return
      const controls = focusable()
      if (!controls.length) return
      const first = controls[0]
      const last = controls.at(-1)!

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [pendingDangerousFile])

  useEffect(() => {
    if (!metricsOpen) return

    const dialog = metricsDialogRef.current
    const previousFocus = metricsTriggerRef.current
    const focusable = () => dialog
      ? [...dialog.querySelectorAll<HTMLElement>('button:not([disabled])')]
      : []

    requestAnimationFrame(() => focusable()[0]?.focus())

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setMetricsOpen(false)
        return
      }

      if (event.key !== 'Tab') return
      const controls = focusable()
      if (!controls.length) return
      const first = controls[0]
      const last = controls.at(-1)!

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [metricsOpen])

  useEffect(() => {
    if (!gamesOpen) return

    const dialog = gamesDialogRef.current
    const previousFocus = gamesTriggerRef.current
    const focusable = () => dialog
      ? [...dialog.querySelectorAll<HTMLElement>('button:not([disabled])')]
      : []

    requestAnimationFrame(() => focusable()[0]?.focus())

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setGamesOpen(false)
        return
      }

      if (event.key !== 'Tab') return
      const controls = focusable()
      if (!controls.length) return
      const first = controls[0]
      const last = controls.at(-1)!

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [gamesOpen])

  const [onlyPeer] = beam.peers
  const keepingConversationOpen = beam.hasConnected && ['waiting', 'peer-found', 'connecting', 'disconnected'].includes(beam.state)
  const recipient = beam.peers.length === 1
    ? onlyPeer?.name ?? 'this Beam'
    : beam.peers.length > 1
      ? `${beam.peers.length} people in this Beam`
      : 'this Beam'

  const copy = async (value: string) => {
    await navigator.clipboard.writeText(value)

    setCopied(true)

    setTimeout(() => setCopied(false), 1600)
  }

  const openMetrics = () => {
    metricsTriggerRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    setMetricsOpen(true)
  }

  const commitName = () => {
    const nextName = nameDraft.trim()
    if (!nextName) {
      setNameDraft(displayName)
      return
    }
    if (nextName === displayName) return
    onRename(nextName)
    beam.rename(nextName)
  }

  const openComposer = (mode: 'text' | 'location') => {
    setComposerMode(mode)
    setShareStatus('')

    if (mode === 'location') {
      setPickedLocation(null)
    } else {
      requestAnimationFrame(() => composerInput.current?.focus())
    }
  }

  const clearComposer = () => {
    setComposer('')
    setPickedLocation(null)
    setComposerMode('text')
    setShareStatus('')
  }

  const resizeComposer = (input: HTMLTextAreaElement) => {
    const maximumHeight = 108

    // Measure from zero rather than `auto`: a textarea's intrinsic auto height
    // is two rows, which otherwise prevents it from shrinking back to one row.
    input.style.height = '0px'
    input.style.height = `${Math.min(input.scrollHeight, maximumHeight)}px`
    input.style.overflowY =
      input.scrollHeight > maximumHeight ? 'auto' : 'hidden'
  }

  const addClipboard = async () => {
    try {
      const value =
        await navigator.clipboard.readText()

      if (!value.trim()) {
        setShareStatus('Your clipboard is empty.')
        return
      }

      setComposer(value)
      openComposer('text')
    } catch {
      setShareStatus(
        'Allow clipboard access to add it here.',
      )
    }
  }

  const addLocation = () => {
    setAttachmentsOpen(false)
    openComposer('location')
  }

  const openGames = () => {
    gamesTriggerRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    setAttachmentsOpen(false)
    setSelectedGameId((current) => current ?? gameLauncherGames[0].id)
    setGamesOpen(true)
  }

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      setShareStatus(
        'Location sharing is not available in this browser.',
      )

      return
    }

    setShareStatus('Getting your location…')

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const {
          latitude: lat,
          longitude: lng,
        } = position.coords

        setPickedLocation({
          lat,
          lng,
        })

        setShareStatus(
          'Pin added. Review it, then send.',
        )
      },
      () =>
        setShareStatus(
          'Couldn’t get your location. Check browser permissions.',
        ),
      {
        enableHighAccuracy: false,
        timeout: 10000,
        maximumAge: 300000,
      },
    )
  }

  if (!connected && !keepingConversationOpen) {
    return (
      <WaitingPage
        secret={secret}
        state={beam.state}
        peers={beam.peers.length}
        password={password}
        isCreator={isCreator}
        quickStartCanvas={quickStartCanvas}
        passwordRequired={beam.passwordRequired}
        onPasswordChange={onPasswordChange}
        onCopy={copy}
        copied={copied}
        onQr={() => setQrOpen(true)}
        onEnd={onEnd}
        onRetry={beam.retryConnection}
        qrOpen={qrOpen}
        closeQr={() => setQrOpen(false)}
      />
    )
  }

  const hasActivity =
    beam.transfers.length > 0 ||
    beam.feed.length > 0
  const completedReceivedFileIds = new Set(
    beam.feed
      .filter((item) => item.kind === 'file' && item.received)
      .map((item) => item.id),
  )

  const activity = [
    ...beam.transfers
      .filter(
        (transfer) =>
          transfer.direction !== 'receiving' ||
          transfer.status !== 'complete' ||
          !completedReceivedFileIds.has(transfer.id),
      )
      .map((transfer) => ({
      type: 'transfer' as const,
      createdAt: transfer.createdAt,
      transfer,
      })),
    ...beam.feed.map((item) => ({
      type: 'message' as const,
      createdAt: item.createdAt,
      item,
    })),
  ].sort((a, b) => a.createdAt - b.createdAt)

  const locationUrl =
    pickedLocation &&
    `https://www.openstreetmap.org/?mlat=${pickedLocation.lat}&mlon=${pickedLocation.lng}#map=16/${pickedLocation.lat}/${pickedLocation.lng}`

  const shareValue =
    composerMode === 'location'
      ? locationUrl ?? ''
      : composer

  const sendMessage = () => {
    if (!connected || !shareValue.trim()) return

    beam.sendItem(
      shareValue,
      isUrl(shareValue) ? 'link' : 'text',
    )
    beam.setTyping(false)
    clearComposer()
  }

  const acceptFile = (transfer: TransferRecord) => {
    if (dataSaver) {
      setPendingDataReceive(transfer)
      return
    }
    confirmFileReceive(transfer)
  }

  const confirmFileReceive = (transfer: TransferRecord) => {
    if (isPotentiallyDangerousFile(transfer.name)) {
      dangerousFileTriggerRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
      setPendingDangerousFile(transfer)
      return
    }

    beam.replyToOffer(transfer.id, true)
  }

  const setDataSaverMode = (enabled: boolean) => {
    localStorage.setItem('beam-data-saver', String(enabled))
    setDataSaver(enabled)
    if (enabled) {
      setAttachmentsOpen(false)
      setComposerMode('text')
      setPickedLocation(null)
    }
  }

  const openCanvas = (action: 'start' | 'join') => {
    if (dataSaver) { setCanvasWarning(action); return }
    if (action === 'start') {
      if (canvasConditions.length) { setCanvasWarning(action); return }
      beam.startCanvas()
      setCanvasOpen(true)
      return
    }
    if (canvasConditions.length) { setCanvasWarning(action); return }
    beam.joinCanvas()
    setCanvasOpen(true)
  }
  const confirmCanvas = () => {
    if (!canvasWarning) return
    if (canvasWarning === 'start') beam.startCanvas()
    else beam.joinCanvas()
    setCanvasWarning(null)
    setCanvasOpen(true)
  }

  return (
    <motion.section
      className="room"
      initial={{
        opacity: 0,
        y: 14,
      }}
      animate={{
        opacity: 1,
        y: 0,
      }}
      exit={{
        opacity: 0,
        y: -10,
      }}
      transition={{
        duration: 0.38,
        ease: [0.16, 1, 0.3, 1],
      }}
    >
      <div className="room-head">
        <div>
          <label className="identity">
            You’re{' '}
            <input
              aria-label="Your display name"
              value={nameDraft}
              maxLength={48}
              onChange={(event) => setNameDraft(event.target.value)}
              onBlur={commitName}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
                if (event.key === 'Escape') {
                  setNameDraft(displayName)
                  event.currentTarget.blur()
                }
              }}
            />
          </label>
        </div>

        <button className="metrics-button" type="button" onClick={openMetrics} aria-label="Open technical metrics" title="Technical metrics">
          <Activity size={18} />
        </button>

        <button
          className="settings-button"
          type="button"
          onClick={() => {
            setPasswordDraft('')
            setRoomCodeVisible(false)
            setSettingsOpen(true)
          }}
          aria-label="Beam settings"
          title="Beam settings"
        >
          <Settings size={18} />
        </button>

        <button
          className="end-button"
          onClick={onEnd}
        >
          <LogOut size={16} />
          <span className="end-button__label">End</span>
        </button>
      </div>

      <details
        className="participants"
        open={participantsExpanded}
        onToggle={(event) => setParticipantsExpanded(event.currentTarget.open)}
      >
        <summary className="participants__title">
          <UserRound size={16} />
          <strong>People in this Beam</strong>
          <span>{beam.peers.length + 1}</span>
          {beam.pendingPeers.length > 0 && (
            <span className="join-request-count" role="status">
              {beam.pendingPeers.length} join {beam.pendingPeers.length === 1 ? 'request' : 'requests'}
            </span>
          )}
          <ChevronDown className="participants__chevron" size={17} aria-hidden="true" />
        </summary>
        <div className="participants__list">
          <span className="participant"><i /> You</span>
          {beam.peers.map((peer) => <span className="participant" key={peer.id}><i /> {peer.name}<button type="button" onClick={() => beam.kickPeer(peer.id)} aria-label={`Remove ${peer.name}`}><UserRoundX size={15} /> Remove</button></span>)}
        </div>
      </details>

      {diagnostics.length > 0 && health.tone !== 'good' && (
        <div
          className={`participants-connection participants-connection--${health.tone}`}
          role="status"
        >
          <Activity size={15} aria-hidden="true" />
          <div>
            <strong>{health.label}</strong>
            <span>{health.guidance}</span>
          </div>
        </div>
      )}

      <section ref={conversationRef} className="conversation" aria-label="Conversation">
        {hasActivity || beam.pendingPeers.length > 0 ? (
          <div className="conversation-feed">
            {activity.map((entry) => entry.type === 'transfer' ? (
              <TransferCard key={entry.transfer.id} item={entry.transfer} onAccept={() => acceptFile(entry.transfer)} onDecline={() => beam.replyToOffer(entry.transfer.id, false)} onCancel={() => beam.cancelTransfer(entry.transfer.id)} />
            ) : <FeedCard key={entry.item.id} item={entry.item} dataSaver={dataSaver} onCanvasJoin={entry.item.kind === 'canvas' ? () => openCanvas('join') : undefined} />)}
            {beam.pendingPeers.length > 0 && (
              <div className="join-request-feed" role="status">
                {beam.pendingPeers.map((peer) => (
                  <div className="join-request-card" key={peer.id}>
                    <div>
                      <strong>Join request</strong>
                      <span>{peer.name} wants to join this Beam.</span>
                    </div>
                    <button className="primary small" type="button" onClick={() => beam.admitPeer(peer.id)}>
                      Allow
                    </button>
                  </div>
                ))}
              </div>
            )}
            {beam.typingPeers.length > 0 && <TypingIndicator peers={beam.typingPeers} />}
          </div>
        ) : (
          <>
            <div className="conversation-empty">
              <span>Private conversation</span>
              <p>Messages and attachments shared here disappear when this Beam ends.</p>
            </div>
            {beam.typingPeers.length > 0 && <TypingIndicator peers={beam.typingPeers} />}
          </>
        )}
      </section>

      <input
        ref={fileInput}
        className="sr-only"
        type="file"
        multiple
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          event.target.value = ''
          if (!files.length) return
          if (dataSaver) setPendingDataFiles(files)
          else files.forEach(beam.offerFile)
        }}
      />

      {keepingConversationOpen ? (
        <section className="reconnect-card" role="status" aria-live="polite" aria-atomic="true">
          <div className="reconnect-card__heading">
            <LoaderCircle size={17} aria-hidden="true" />
            <div>
              <strong>Waiting for a connection</strong>
              <span>Share this code with someone to join this Beam. Your conversation history is kept until someone joins your Beam.</span>
            </div>
          </div>
          <div className="reconnect-card__code-row">
            <code>{secret}</code>
            <button type="button" onClick={() => void copy(secret)}>
              {copied ? <Check size={17} aria-hidden="true" /> : <Copy size={17} aria-hidden="true" />}
              {copied ? 'Copied' : 'Copy code'}
            </button>
          </div>
        </section>
      ) : <form className="chat-composer" onSubmit={(event) => {
        event.preventDefault()
        sendMessage()
      }}>
        {composerMode === 'location' ? (
          <div className="location-draft">
            <div className="location-draft__head">
              <strong>Location attachment</strong>
              <button type="button" onClick={clearComposer} aria-label="Remove location attachment"><X size={16} /></button>
            </div>
            <MapPinPicker pin={pickedLocation} onPick={(pin) => {
              setPickedLocation(pin)
              setShareStatus('Pin added. Ready to send.')
            }} />
            <div className="location-draft__actions">
              <span>{pickedLocation ? `${pickedLocation.lat.toFixed(5)}, ${pickedLocation.lng.toFixed(5)}` : 'Choose a point on the map'}</span>
              <button className="quiet-button" type="button" onClick={useCurrentLocation}><MapPin size={15} /> Use my location</button>
            </div>
          </div>
        ) : (
          <div className="chat-composer__text-row">
            <div className="attachment-actions" ref={attachmentActionsRef}>
              <button className={`attachment-action ${attachmentsOpen ? 'is-open' : ''}`} type="button" disabled={!connected} onClick={() => setAttachmentsOpen((open) => !open)} aria-label={attachmentsOpen ? 'Close sharing options' : 'More sharing options'} aria-expanded={attachmentsOpen} aria-haspopup="menu"><Plus size={20} /></button>
              {attachmentsOpen && <div className="attachment-menu" role="menu">
                <button type="button" role="menuitem" onClick={() => { setAttachmentsOpen(false); fileInput.current?.click() }}><FileText size={17} /> File</button>
                <button type="button" role="menuitem" onClick={addLocation}><MapPin size={17} /> Location</button>
                <button type="button" role="menuitem" onClick={() => { setAttachmentsOpen(false); void addClipboard() }}><Clipboard size={17} /> Paste</button>
                <button type="button" role="menuitem" onClick={() => { setAttachmentsOpen(false); openCanvas('start') }}><Paintbrush size={17} /> Canvas</button>
                <button type="button" role="menuitem" onClick={openGames}><Gamepad2 size={17} /> Games</button>
              </div>}
            </div>
            <textarea
              ref={composerInput}
              value={composer}
              maxLength={8_000}
              disabled={!connected}
              onChange={(event) => {
                setComposer(event.target.value)
                beam.setTyping(Boolean(event.target.value.trim()))
                resizeComposer(event.currentTarget)
              }}
              onBlur={() => beam.setTyping(false)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  sendMessage()
                }
              }}
              placeholder={connected ? `Message ${recipient}` : 'Waiting for a connection…'}
              aria-label="Message"
            />
            <button className="send-message" disabled={!connected || !shareValue.trim()} type="submit" aria-label="Send message"><Send size={18} /></button>
          </div>
        )}

        {composerMode === 'location' && <div className="chat-composer__bottom">
          <button className="send-message" disabled={!connected || !shareValue.trim()} type="submit" aria-label="Send location"><Send size={18} /><span>Send</span></button>
        </div>}
      </form>}

      {shareStatus && (
        <p
          className="share-status"
          role="status"
        >
          {shareStatus}
        </p>
      )}

      <AnimatePresence>
        {canvasOpen && beam.canvas && <motion.div className="dialog-backdrop canvas-backdrop" role="presentation" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <CanvasBoard canvas={beam.canvas} traffic={beam.canvasTraffic} presence={beam.canvasPresence} displayName={displayName} dataSaver={dataSaver} onClose={() => setCanvasOpen(false)} onRename={beam.renameCanvas} onStroke={beam.addCanvasStroke} onStrokeStart={beam.startCanvasStroke} onStrokePoints={beam.appendCanvasStrokePoints} onDrawing={beam.setCanvasDrawing} onImage={beam.addCanvasImage} onDelete={beam.deleteCanvasElement} />
        </motion.div>}
        {canvasWarning && <motion.div className="dialog-backdrop" role="presentation" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <section className="canvas-warning" role="dialog" aria-modal="true" aria-labelledby="canvas-warning-title">
            <Paintbrush size={24} aria-hidden="true" />
            <h2 id="canvas-warning-title">Check your canvas setup</h2>
            {dataSaver && <p>Data saver will use fewer live drawing updates and stronger image compression after you {canvasWarning === 'start' ? 'create' : 'join'} this canvas.</p>}
            {canvasConditions.map((condition) => <p key={condition}>{condition}</p>)}
            <p className="canvas-warning__note">Drawing stays end-to-end encrypted. Images are compressed before they are shared.</p>
            <div><button type="button" className="quiet-button" onClick={() => setCanvasWarning(null)}>Cancel</button><button type="button" className="primary" onClick={confirmCanvas}>{canvasWarning === 'start' ? 'Start anyway' : 'Join anyway'}</button></div>
          </section>
        </motion.div>}
        {gamesOpen && <motion.div className="dialog-backdrop" role="presentation" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={() => setGamesOpen(false)}>
          <motion.section ref={gamesDialogRef} className="games-launcher-dialog" role="dialog" aria-modal="true" aria-labelledby="games-launcher-title" aria-describedby="games-launcher-description" initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.98 }} onMouseDown={(event) => event.stopPropagation()}>
            <header className="games-launcher-dialog__head">
              <div>
                <h2 id="games-launcher-title">Pick a world. Bring the room.</h2>
                <p id="games-launcher-description">Eleven turn-based game concepts for the people already in your Beam. Every game is still in development.</p>
              </div>
              <button type="button" className="games-launcher-dialog__close" onClick={() => setGamesOpen(false)} aria-label="Close game library"><X size={20} aria-hidden="true" /></button>
            </header>
            <div className="games-launcher-dialog__content">
              <div className="games-launcher-grid" aria-label="Available game concepts">
                {gameLauncherGames.map((game) => {
                  const selected = selectedGameId === game.id
                  return <button key={game.id} type="button" className={`games-launcher-card ${selected ? 'is-selected' : ''}`} aria-pressed={selected} onClick={() => setSelectedGameId(game.id)}>
                    <span className="games-launcher-card__art" aria-hidden="true"><GameArtwork gameId={game.id} /></span>
                    <span className="games-launcher-card__copy"><strong>{game.title}</strong><span>{game.genre}</span><em>{game.players}</em></span>
                  </button>
                })}
              </div>
              <aside className="games-launcher-detail" aria-live="polite">
                {selectedGameId ? (() => {
                  const game = gameLauncherGames.find((entry) => entry.id === selectedGameId)!
                  return <>
                    <span className="games-launcher-detail__mark" aria-hidden="true"><GameArtwork gameId={game.id} /></span>
                    <p className="games-launcher-detail__genre">{game.genre}</p>
                    <p className="games-launcher-detail__label">Recommended for {game.players}</p>
                    <h3>{game.title}</h3>
                    <p>{game.summary}</p>
                    <p className="games-launcher-detail__status">In development <span aria-hidden="true">·</span> Not playable yet</p>
                  </>
                })() : <div className="games-launcher-detail__empty"><Gamepad2 size={24} aria-hidden="true" /><h3>Choose a cover</h3><p>Select any game to read its description and recommended group size.</p></div>}
              </aside>
            </div>
          </motion.section>
        </motion.div>}
      </AnimatePresence>

      <AnimatePresence>
        {pendingDangerousFile && (
          <motion.div
            className="dialog-backdrop"
            role="presentation"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onMouseDown={() => setPendingDangerousFile(null)}
          >
            <motion.section
              ref={dangerousFileDialogRef}
              className="dangerous-file-dialog"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="dangerous-file-title"
              aria-describedby="dangerous-file-description"
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="dangerous-file-dialog__icon"><FileText size={20} aria-hidden="true" /></div>
              <h2 id="dangerous-file-title">This file could be unsafe</h2>
              <p id="dangerous-file-description"><strong>{pendingDangerousFile.name}</strong> can contain executable or malicious code. Only accept it if you trust the sender and were expecting it.</p>
              <div className="dangerous-file-dialog__actions">
                <button className="quiet-button" type="button" onClick={() => setPendingDangerousFile(null)}>Cancel</button>
                <button className="primary small" type="button" onClick={() => {
                  beam.replyToOffer(pendingDangerousFile.id, true)
                  setPendingDangerousFile(null)
                }}>Accept anyway</button>
              </div>
            </motion.section>
          </motion.div>
        )}
        {pendingDataFiles && (
          <motion.div className="dialog-backdrop" role="presentation" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={() => setPendingDataFiles(null)}>
            <motion.section className="data-saver-dialog" role="dialog" aria-modal="true" aria-labelledby="data-saver-send-title" aria-describedby="data-saver-send-description" initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.98 }} onMouseDown={(event) => event.stopPropagation()}>
              <div className="data-saver-dialog__icon"><FileText size={20} aria-hidden="true" /></div>
              <h2 id="data-saver-send-title">Send files using data?</h2>
              <p id="data-saver-send-description">These {pendingDataFiles.length === 1 ? 'file is' : 'files are'} {formatBytes(pendingDataFiles.reduce((total, file) => total + file.size, 0))}. Data saver will not create previews, but sending still uses your connection data.</p>
              <div className="data-saver-dialog__actions"><button className="quiet-button" type="button" onClick={() => setPendingDataFiles(null)}>Cancel</button><button className="primary small" type="button" onClick={() => { pendingDataFiles.forEach(beam.offerFile); setPendingDataFiles(null) }}>Send files</button></div>
            </motion.section>
          </motion.div>
        )}
        {pendingDataReceive && (
          <motion.div className="dialog-backdrop" role="presentation" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: 8 }} onMouseDown={() => setPendingDataReceive(null)}>
            <motion.section className="data-saver-dialog" role="dialog" aria-modal="true" aria-labelledby="data-saver-receive-title" aria-describedby="data-saver-receive-description" initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.98 }} onMouseDown={(event) => event.stopPropagation()}>
              <div className="data-saver-dialog__icon"><Download size={20} aria-hidden="true" /></div>
              <h2 id="data-saver-receive-title">Receive this file using data?</h2>
              <p id="data-saver-receive-description"><strong>{pendingDataReceive.name}</strong> is {formatBytes(pendingDataReceive.size)}. Data saver will not create a preview, but receiving still uses your connection data.</p>
              <div className="data-saver-dialog__actions"><button className="quiet-button" type="button" onClick={() => setPendingDataReceive(null)}>Cancel</button><button className="primary small" type="button" onClick={() => { const transfer = pendingDataReceive; setPendingDataReceive(null); confirmFileReceive(transfer) }}>Receive file</button></div>
            </motion.section>
          </motion.div>
        )}
        {metricsOpen && (
          <motion.div className="dialog-backdrop" role="presentation" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={() => setMetricsOpen(false)}>
            <motion.section ref={metricsDialogRef} className="metrics-dialog" role="dialog" aria-modal="true" aria-labelledby="beam-metrics-title" initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.98 }} onMouseDown={(event) => event.stopPropagation()}>
              <div className="metrics-dialog__head"><div><Activity size={19} aria-hidden="true" /><div><h2 id="beam-metrics-title">Connection details</h2><p>A quick look at how this Beam is performing.</p></div></div><button type="button" onClick={() => setMetricsOpen(false)} aria-label="Close connection details"><X size={18} /></button></div>
              <div className="metrics-dialog__privacy"><LockKeyhole size={15} aria-hidden="true" /> Private by design: network addresses are never shown.</div>
              <section className={`connection-health connection-health--${health.tone}`} aria-live="polite"><strong>{health.label}</strong><p>{health.guidance}</p></section>
              {diagnostics.length > 0 ? <div className="metrics-peers">{diagnostics.map((diagnostic, index) => <section className="metrics-peer" key={diagnostic.peerId}><h3>{beam.peers.find(peer => peer.id === diagnostic.peerId)?.name ?? `Connected peer ${index + 1}`}</h3><dl><Metric icon={Network} label="Connection path" value={diagnostic.route === 'turn-relay' ? 'Via relay' : titleCase(diagnostic.route)} help="Whether your connection reaches this person directly or goes through a secure relay." /><Metric icon={Network} label="Connection type" value={diagnostic.transport.toUpperCase()} help="The network protocol your browser selected for this connection." /><Metric icon={Gauge} label="Response time" value={formatMilliseconds(diagnostic.currentRoundTripTimeMs)} help="How long it takes for a small signal to travel to the other person and back. Lower is usually better." /><Metric icon={Gauge} label="Available bandwidth" value={formatBitrate(diagnostic.availableBandwidth)} help="Beam measures this by sending a brief private probe to the other peer. The result is refreshed at most once every 15 seconds while this panel is open." /><Metric icon={ArrowUp} label="Data sent" value={formatBytesOrUnavailable(diagnostic.bytesSent)} /><Metric icon={ArrowDown} label="Data received" value={formatBytesOrUnavailable(diagnostic.bytesReceived)} /></dl></section>)}</div> : <p className="metrics-empty">Connection details will appear when your browser makes them available.</p>}
              <section className="metrics-transfers"><h3>File transfers</h3>{beam.transfers.length ? <div>{beam.transfers.map((transfer) => <TransferMetric key={transfer.id} transfer={transfer} />)}</div> : <p>No files have been transferred in this Beam yet.</p>}</section>
              <p className="metrics-dialog__updated"><RefreshCw size={13} /> Updates every 2 seconds{diagnosticsUpdatedAt ? ` · checked ${new Intl.DateTimeFormat(undefined, {hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(diagnosticsUpdatedAt)}` : ''}</p>
            </motion.section>
          </motion.div>
        )}
        {settingsOpen && (
          <motion.div
            className="dialog-backdrop"
            role="presentation"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onMouseDown={() => setSettingsOpen(false)}
          >
            <motion.section
              className="settings-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="beam-settings-title"
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="settings-dialog__head">
                <div><Settings size={19} /><h2 id="beam-settings-title">Beam settings</h2></div>
                <button type="button" onClick={() => setSettingsOpen(false)} aria-label="Close settings"><X size={18} /></button>
              </div>

              <section className="settings-dialog__section settings-dialog__room-code" aria-labelledby="room-code-title">
                <div>
                  <strong id="room-code-title">Room code</strong>
                  <p>Keep this code private. Anyone with it can try to join this Beam.</p>
                </div>
                <div className="settings-dialog__room-code-value">
                  <code className={roomCodeVisible ? '' : 'is-blurred'}>{secret}</code>
                  <button
                    className="quiet-button"
                    type="button"
                    onClick={() => setRoomCodeVisible((visible) => !visible)}
                    aria-pressed={roomCodeVisible}
                    aria-label={roomCodeVisible ? 'Hide room code' : 'Show room code'}
                  >
                    {roomCodeVisible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                    {roomCodeVisible ? 'Hide' : 'Show'}
                  </button>
                </div>
              </section>

              {isCreator ? (
                <>
                  {PASSWORD_FEATURE_ENABLED && <form className="settings-dialog__section" onSubmit={(event) => {
                    event.preventDefault()
                    onPasswordChange(passwordDraft)
                    setSettingsOpen(false)
                  }}>
                    <div><strong>Password</strong><p>Changes apply to new joiners only. People already connected stay in this Beam.</p></div>
                    <label htmlFor="settings-password">New password <span>(leave blank to remove)</span></label>
                    <div className="settings-dialog__password"><input id="settings-password" type="password" autoComplete="new-password" value={passwordDraft} onChange={(event) => setPasswordDraft(event.target.value)} placeholder="No password" /><button className="primary" type="submit">Save</button></div>
                  </form>}

                  {!PASSWORD_FEATURE_ENABLED && <p className="settings-dialog__note">Password protection is temporarily unavailable for this Beam.</p>}

                  <div className="settings-dialog__section settings-dialog__toggle">
                    <div><strong>Free for ALL</strong><p>Anyone with the Beam code can join instantly. No approval is needed after the first member joins.</p></div>
                    <button className={`toggle ${beam.freeForAll ? 'on' : ''}`} type="button" role="switch" aria-checked={beam.freeForAll} onClick={() => beam.setFreeForAll(!beam.freeForAll)}><span /></button>
                  </div>
                </>
              ) : (
                <p className="settings-dialog__note">Only the person who started this Beam can change its password or joining mode.</p>
              )}
              <div className="settings-dialog__section settings-dialog__toggle">
              <div><strong>Data saver</strong><p>{dataSaver ? 'On for this browser only. Files, locations, and Canvas stay available with lower-data behavior.' : 'Reduce data use on this browser. This does not change anyone else’s Beam.'}</p></div>
                <button className={`toggle ${dataSaver ? 'on' : ''}`} type="button" role="switch" aria-checked={dataSaver} onClick={() => dataSaver ? setDataSaverMode(false) : setDataSaverWarningOpen(true)} aria-label="Toggle data saver"><span /></button>
              </div>
              <button className="settings-dialog__metrics" type="button" onClick={() => { setSettingsOpen(false); openMetrics() }}><Activity size={17} /> Connection details</button>
            </motion.section>
          </motion.div>
        )}
        {dataSaverWarningOpen && (
          <motion.div className="dialog-backdrop" role="presentation" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={() => setDataSaverWarningOpen(false)}>
            <motion.section className="data-saver-dialog" role="dialog" aria-modal="true" aria-labelledby="data-saver-title" aria-describedby="data-saver-description" initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.98 }} onMouseDown={(event) => event.stopPropagation()}>
              <div className="data-saver-dialog__icon"><WifiOff size={20} aria-hidden="true" /></div>
              <h2 id="data-saver-title">Turn on data saver?</h2>
              <p id="data-saver-description">Your Beam experience will be noticeably worse. This setting affects only this browser, not anyone else in the Beam.</p>
              <ul><li>Removes typing indicators.</li><li>Keeps files and locations available, without attachment or map previews.</li><li>Asks before file uploads and downloads because they can use significant data.</li><li>Keeps Canvas available with fewer live updates and stronger image compression.</li><li>Warns you before creating or joining a Canvas.</li></ul>
              <div className="data-saver-dialog__actions"><button className="quiet-button" type="button" onClick={() => setDataSaverWarningOpen(false)}>Cancel</button><button className="primary small" type="button" onClick={() => { setDataSaverMode(true); setDataSaverWarningOpen(false) }}>Turn on data saver</button></div>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>

    </motion.section>
  )
}

function TypingIndicator({ peers }: { peers: { id: string; name: string }[] }) {
  const names = peers.map(peer => peer.name)
  const label = names.length === 1 ? `${names[0]} is typing` : `${names.join(', ')} are typing`
  return <div className="typing-indicator" role="status" aria-live="polite" aria-atomic="true" aria-label={label}>
    <span>{label}</span>
    <span className="typing-indicator__dots" aria-hidden="true"><i /><i /><i /></span>
  </div>
}

function Metric({
  icon: Icon,
  label,
  value,
  help,
}: {
  icon: ComponentType<{ size?: number; 'aria-hidden'?: boolean }>
  label: string
  value: string
  help?: string
}) {
  return <div className="metric"><dt><Icon size={14} aria-hidden={true} /><span>{label}</span>{help && <MetricHelp label={label} text={help} />}</dt><dd>{value}</dd></div>
}

function MetricHelp({ label, text }: { label: string; text: string }) {
  return <button className="metric-help" type="button" aria-label={`What does ${label} mean? ${text}`} data-tooltip={text}><span aria-hidden="true">?</span></button>
}

function TransferMetric({ transfer }: { transfer: TransferRecord }) {
  return <article className="transfer-metric"><div><strong>{transfer.name}</strong><span>{transfer.direction === 'sending' ? 'Sending' : 'Receiving'} · {transfer.status}</span></div><dl><Metric icon={FileText} label="File size" value={formatBytes(transfer.size)} /><Metric icon={Activity} label="Progress" value={`${Math.round(transfer.progress * 100)}%`} /><Metric icon={Gauge} label="Current speed" value={`${formatBytes(transfer.speed)}/s`} help="How fast this file is moving right now. The speed can rise and fall during a transfer." /><Metric icon={Clock3} label="Time taken" value={transfer.elapsedMs === undefined ? '—' : formatMilliseconds(transfer.elapsedMs)} help="How long this file transfer has been running." /></dl></article>
}

function titleCase(value: string) { return value.charAt(0).toUpperCase() + value.slice(1) }
function formatMilliseconds(value: number | null) { return value === null ? 'Unavailable' : `${Math.round(value)} ms` }
function formatBitrate(value: number | null) { if (value === null) return 'Unavailable'; if (value < 1_000) return `${Math.round(value)} bit/s`; if (value < 1_000_000) return `${(value / 1_000).toFixed(1)} kbit/s`; return `${(value / 1_000_000).toFixed(1)} Mbit/s` }
function formatBytesOrUnavailable(value: number | null) { return value === null ? 'Unavailable' : formatBytes(value) }

function MapPinPicker({
  pin,
  onPick,
}: {
  pin: {
    lat: number
    lng: number
  } | null
  onPick(pin: {
    lat: number
    lng: number
  }): void
}) {
  return (
    <MapContainer
      className="map-picker"
      center={[47.4979, 19.0402]}
      zoom={13}
      scrollWheelZoom
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <MapClickHandler
        onPick={onPick}
      />

      {pin && (
        <SelectedPin pin={pin} />
      )}
    </MapContainer>
  )
}

function MapClickHandler({
  onPick,
}: {
  onPick(pin: {
    lat: number
    lng: number
  }): void
}) {
  useMapEvents({
    click(event) {
      onPick(event.latlng)
    },
  })

  return null
}

function SelectedPin({
  pin,
}: {
  pin: {
    lat: number
    lng: number
  }
}) {
  const map = useMap()

  useEffect(() => {
    map.setView(
      [pin.lat, pin.lng],
      Math.max(map.getZoom(), 16),
    )
  }, [
    map,
    pin.lat,
    pin.lng,
  ])

  return (
    <CircleMarker
      center={[
        pin.lat,
        pin.lng,
      ]}
      radius={9}
      pathOptions={{
        color: '#455ef5',
        fillColor: '#455ef5',
        fillOpacity: 1,
        weight: 3,
      }}
    />
  )
}

function TransferCard({
  item,
  onAccept,
  onDecline,
  onCancel,
}: {
  item: TransferRecord
  onAccept(): void
  onDecline(): void
  onCancel(): void
}) {
  const needsReply =
    item.direction === 'receiving' &&
    item.status === 'offered'
  const isComplete = item.status === 'complete'
  const timestamp = formatMessageTime(item.createdAt)

  return (
    <motion.article
      className={`transfer-card ${item.direction === 'receiving' ? 'received-message' : 'sent-message'}`}
      data-time={timestamp}
      title={timestamp}
      initial={{
        opacity: 0,
        y: 8,
      }}
      animate={{
        opacity: 1,
        y: 0,
      }}
    >
      <div className="file-mark">
        <FileText size={19} />
      </div>

      <div className="transfer-main">
        <div className="transfer-title">
          <strong title={item.name}>
            {item.name}
          </strong>

          <span>
            {formatBytes(item.size)}
          </span>
        </div>

        {needsReply ? (
          <div className="offer-buttons">
            <button
              className="quiet-button"
              onClick={onDecline}
            >
              Decline
            </button>

            <button
              className="primary small"
              onClick={onAccept}
            >
              Accept
            </button>
          </div>
        ) : (
          <>
            {!isComplete && (
              <div className="progress">
                <i
                  style={{
                    transform: `scaleX(${item.progress})`,
                  }}
                />
              </div>
            )}

            <div className="transfer-meta">
              <span className={isComplete ? 'transfer-status' : undefined}>
                {isComplete
                  ? 'Complete'
                  : item.status ===
                      'declined'
                    ? 'Declined'
                    : item.status ===
                        'cancelled'
                      ? 'Cancelled'
                      : `${Math.round(item.progress * 100)}% · ${formatBytes(item.speed)}/s`}
              </span>

              {[
                'offered',
                'active',
              ].includes(
                item.status,
              ) && (
                <button
                  onClick={onCancel}
                >
                  Cancel
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </motion.article>
  )
}

function FeedCard({
  item,
  dataSaver,
  onCanvasJoin,
}: {
  item: FeedItem
  dataSaver: boolean
  onCanvasJoin?: () => void
}) {
  const timestamp = formatMessageTime(item.createdAt)

  if (item.kind === 'system') {
    return (
      <article className={`system-event ${onCanvasJoin ? 'system-event--canvas' : ''}`} title={timestamp} aria-label={`${item.value} ${timestamp}`}>
        <span>{item.value}</span>
        {onCanvasJoin && <button type="button" onClick={onCanvasJoin}><Paintbrush size={15} /> Join canvas</button>}
        <time dateTime={new Date(item.createdAt).toISOString()}>{timestamp}</time>
      </article>
    )
  }

  if (item.kind === 'canvas') {
    return <div className={`message-stack ${item.received ? 'message-stack--received' : 'message-stack--sent'}`}>
      {item.received && <span className="message-sender">{item.sender}</span>}
      <article className={`feed-item feed-item--canvas ${item.received ? 'received-message' : 'sent-message'}`} data-time={timestamp} title={timestamp}>
        <div><span className="feed-item--canvas__icon"><Paintbrush size={17} /></span><strong>{item.value}</strong><span>{item.received ? `${item.sender} started a canvas` : 'You started a canvas'}</span></div>
        {onCanvasJoin && <button type="button" onClick={onCanvasJoin} aria-label={item.received ? 'Join canvas' : 'Open canvas'}><span className="canvas-invite__action-full">{item.received ? 'Join canvas' : 'Open canvas'}</span><span className="canvas-invite__action-compact" aria-hidden="true">{item.received ? 'Join' : 'Open'}</span></button>}
      </article>
    </div>
  }

  const location =
    item.kind === 'link'
      ? locationFromUrl(item.value)
      : null

  return (
    <div className={`message-stack ${item.received ? 'message-stack--received' : 'message-stack--sent'}`}>
      {item.received && <span className="message-sender">{item.sender}</span>}
      <article className={`feed-item feed-item--${location ? 'location' : item.kind} ${item.received ? 'received-message' : 'sent-message'}`} data-time={timestamp} title={timestamp}>
        <div className={item.kind === 'file' ? 'file-message__details' : undefined}>
          {item.kind === 'file' && <span className="file-message__mark" aria-hidden="true"><FileText size={16} /></span>}
          <div>
            <strong>
              {location
                ? 'Location'
                : item.kind === 'link'
                ? hostnameFor(item.value)
                : item.value}
            </strong>

            {item.kind === 'file' && item.size !== undefined && (
              <span className="file-message__size">{formatBytes(item.size)}</span>
            )}

            {location && !dataSaver && (
              <LocationPreview
                location={location}
                href={item.value}
              />
            )}
          </div>
        </div>

      {item.kind === 'file' &&
      item.objectUrl ? (
        <a
          className="file-message__download"
          href={item.objectUrl}
          download={item.value}
          aria-label={`Download ${item.value}`}
          title={`Download ${item.value}`}
        >
          <Download size={17} />
        </a>
      ) : item.kind === 'link' ? (
        <a
          href={item.value}
          target="_blank"
          rel="noreferrer"
        >
          Open
        </a>
      ) : (
        <button
          onClick={() =>
            void navigator.clipboard.writeText(
              item.value,
            )
          }
        >
          Copy
        </button>
      )}
      </article>
    </div>
  )
}

function locationFromUrl(value: string) {
  try {
    const url = new URL(value)

    if (!url.hostname.endsWith('openstreetmap.org')) {
      return null
    }

    const lat = Number(url.searchParams.get('mlat'))
    const lng = Number(url.searchParams.get('mlon'))

    return Number.isFinite(lat) && Number.isFinite(lng)
      ? { lat, lng }
      : null
  } catch {
    return null
  }
}

function LocationPreview({
  location,
  href,
}: {
  location: { lat: number; lng: number }
  href: string
}) {
  return (
    <a
      className="location-preview"
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label="Open shared location in OpenStreetMap"
    >
      <MapContainer
        center={[location.lat, location.lng]}
        zoom={14}
        zoomControl={false}
        attributionControl={false}
        dragging={false}
        scrollWheelZoom={false}
        doubleClickZoom={false}
        touchZoom={false}
        keyboard={false}
        className="location-preview__map"
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <CircleMarker
          center={[location.lat, location.lng]}
          radius={7}
          pathOptions={{
            color: '#fff',
            fillColor: '#455ef5',
            fillOpacity: 1,
            weight: 3,
          }}
        />
      </MapContainer>
      <span className="location-preview__label">
        View on map
      </span>
    </a>
  )
}

function formatMessageTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(timestamp)
}
