import { AnimatePresence, motion } from 'framer-motion'
import { Activity, ChevronDown, Clipboard, Download, Eye, EyeOff, FileText, LockKeyhole, LogOut, MapPin, Paintbrush, Plus, RefreshCw, Send, Settings, UserRound, UserRoundX, WifiOff, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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

export function ConnectedPage({
  secret,
  password,
  isCreator,
  displayName,
  onRename,
  onEnd,
  onPasswordChange,
}: {
  secret: string
  password: string
  isCreator: boolean
  displayName: string
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
  const [canvasOpen, setCanvasOpen] = useState(false)
  const [canvasWarning, setCanvasWarning] = useState<'start' | 'join' | null>(null)
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
    beam.pendingPeers.length +
    beam.typingPeerIds.length

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
      const next = await beam.getDiagnostics()
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

  const [onlyPeer] = beam.peers
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
    beam.setTyping(false)
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

  if (!connected) {
    return (
      <WaitingPage
        secret={secret}
        state={beam.state}
        peers={beam.peers.length}
        password={password}
        isCreator={isCreator}
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
  const typingNames = beam.typingPeerIds
    .map((peerId) => beam.peers.find((peer) => peer.id === peerId)?.name)
    .filter((name): name is string => Boolean(name))
  const typingLabel = typingNames.length === 1
    ? `${typingNames[0]} is typing`
    : typingNames.length === 2
      ? `${typingNames[0]} and ${typingNames[1]} are typing`
      : `${typingNames.length} people are typing`

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
    if (!shareValue.trim()) return

    beam.sendItem(
      shareValue,
      isUrl(shareValue) ? 'link' : 'text',
    )
    clearComposer()
  }

  const acceptFile = (transfer: TransferRecord) => {
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
    if (dataSaver) return
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

        <button className="metrics-button" type="button" onClick={() => setMetricsOpen(true)} aria-label="Open technical metrics" title="Technical metrics">
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
        {hasActivity || beam.pendingPeers.length > 0 || typingNames.length > 0 ? (
          <div className="conversation-feed">
            {activity.map((entry) => entry.type === 'transfer' ? (
              <TransferCard key={entry.transfer.id} item={entry.transfer} onAccept={() => acceptFile(entry.transfer)} onDecline={() => beam.replyToOffer(entry.transfer.id, false)} onCancel={() => beam.cancelTransfer(entry.transfer.id)} />
            ) : <FeedCard key={entry.item.id} item={entry.item} dataSaver={dataSaver} onCanvasJoin={dataSaver ? undefined : entry.item.kind === 'canvas' ? () => openCanvas('join') : undefined} />)}
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
            {typingNames.length > 0 && (
              <div className="typing-indicator" role="status" aria-live="polite" aria-atomic="true">
                <span className="typing-indicator__dots" aria-hidden="true"><i /><i /><i /></span>
                <span>{typingLabel}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="conversation-empty">
            <span>Private conversation</span>
            <p>Messages and attachments shared here disappear when this Beam ends.</p>
          </div>
        )}
      </section>

      <input
        ref={fileInput}
        className="sr-only"
        type="file"
        multiple
        onChange={(event) =>
          Array.from(
            event.target.files ?? [],
          ).forEach(beam.offerFile)
        }
      />

      <form className="chat-composer" onSubmit={(event) => {
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
              <button className={`attachment-action ${attachmentsOpen ? 'is-open' : ''}`} type="button" onClick={() => setAttachmentsOpen((open) => !open)} aria-label={attachmentsOpen ? 'Close sharing options' : 'More sharing options'} aria-expanded={attachmentsOpen} aria-haspopup="menu"><Plus size={20} /></button>
              {attachmentsOpen && <div className="attachment-menu" role="menu">
                {!dataSaver && <button type="button" role="menuitem" onClick={() => { setAttachmentsOpen(false); fileInput.current?.click() }}><FileText size={17} /> File</button>}
                {!dataSaver && <button type="button" role="menuitem" onClick={addLocation}><MapPin size={17} /> Location</button>}
                <button type="button" role="menuitem" onClick={() => { setAttachmentsOpen(false); void addClipboard() }}><Clipboard size={17} /> Paste</button>
                {!dataSaver && <button type="button" role="menuitem" onClick={() => { setAttachmentsOpen(false); openCanvas('start') }}><Paintbrush size={17} /> Canvas</button>}
              </div>}
            </div>
            <textarea
              ref={composerInput}
              value={composer}
              maxLength={dataSaver ? 1_000 : 8_000}
              onChange={(event) => {
                setComposer(event.target.value)
                beam.setTyping(event.target.value.trim().length > 0)
                resizeComposer(event.currentTarget)
              }}
              onBlur={() => beam.setTyping(false)}
              onFocus={() => beam.setTyping(composer.trim().length > 0)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  sendMessage()
                }
              }}
              placeholder={`Message ${recipient}`}
              aria-label="Message"
            />
            <button className="send-message" disabled={!shareValue.trim()} type="submit" aria-label="Send message"><Send size={18} /></button>
          </div>
        )}

        {composerMode === 'location' && <div className="chat-composer__bottom">
          <button className="send-message" disabled={!shareValue.trim()} type="submit" aria-label="Send location"><Send size={18} /><span>Send</span></button>
        </div>}
      </form>

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
          <CanvasBoard canvas={beam.canvas} traffic={beam.canvasTraffic} displayName={displayName} onClose={() => setCanvasOpen(false)} onRename={beam.renameCanvas} onStroke={beam.addCanvasStroke} onStrokeStart={beam.startCanvasStroke} onStrokePoints={beam.appendCanvasStrokePoints} onImage={beam.addCanvasImage} onDelete={beam.deleteCanvasElement} />
        </motion.div>}
        {canvasWarning && <motion.div className="dialog-backdrop" role="presentation" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <section className="canvas-warning" role="dialog" aria-modal="true" aria-labelledby="canvas-warning-title">
            <Paintbrush size={24} aria-hidden="true" />
            <h2 id="canvas-warning-title">Check your canvas setup</h2>
            {canvasConditions.map((condition) => <p key={condition}>{condition}</p>)}
            <p className="canvas-warning__note">Drawing stays end-to-end encrypted. Images are compressed before they are shared.</p>
            <div><button type="button" className="quiet-button" onClick={() => setCanvasWarning(null)}>Cancel</button><button type="button" className="primary" onClick={confirmCanvas}>{canvasWarning === 'start' ? 'Start anyway' : 'Join anyway'}</button></div>
          </section>
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
        {metricsOpen && (
          <motion.div className="dialog-backdrop" role="presentation" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={() => setMetricsOpen(false)}>
            <motion.section className="metrics-dialog" role="dialog" aria-modal="true" aria-labelledby="beam-metrics-title" initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.98 }} onMouseDown={(event) => event.stopPropagation()}>
              <div className="metrics-dialog__head"><div><Activity size={19} /><div><h2 id="beam-metrics-title">Technical metrics</h2></div></div><button type="button" onClick={() => setMetricsOpen(false)} aria-label="Close technical metrics"><X size={18} /></button></div>
              <div className="metrics-dialog__privacy"><LockKeyhole size={15} /> Candidate addresses are never shown.</div>
              <section className={`connection-health connection-health--${health.tone}`} aria-live="polite"><strong>{health.label}</strong><p>{health.guidance}</p></section>
              {diagnostics.length > 0 ? <div className="metrics-peers">{diagnostics.map((diagnostic, index) => <section className="metrics-peer" key={diagnostic.peerId}><h3>{beam.peers.find(peer => peer.id === diagnostic.peerId)?.name ?? `Connected peer ${index + 1}`}</h3><dl><Metric label="Route" value={diagnostic.route === 'turn-relay' ? 'TURN relay' : titleCase(diagnostic.route)} /><Metric label="Transport" value={diagnostic.transport.toUpperCase()} /><Metric label="Round-trip time" value={formatMilliseconds(diagnostic.currentRoundTripTimeMs)} /><Metric label="Available uplink" value={formatBitrate(diagnostic.availableOutgoingBitrate)} /><Metric label="Bytes sent" value={formatBytesOrUnavailable(diagnostic.bytesSent)} /><Metric label="Bytes received" value={formatBytesOrUnavailable(diagnostic.bytesReceived)} /><Metric label="Local candidate" value={diagnostic.localCandidateType ?? 'Unavailable'} /><Metric label="Remote candidate" value={diagnostic.remoteCandidateType ?? 'Unavailable'} /></dl></section>)}</div> : <p className="metrics-empty">Connection data will appear once the browser publishes it.</p>}
              <section className="metrics-transfers"><h3>Transfer telemetry</h3>{beam.transfers.length ? <div>{beam.transfers.map((transfer) => <TransferMetric key={transfer.id} transfer={transfer} />)}</div> : <p>No file transfers in this Beam yet.</p>}</section>
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
                <div><strong>Data saver</strong><p>{dataSaver ? 'On for this browser only. Beam is using text-only sharing to minimize traffic.' : 'Reduce data use on this browser. This does not change anyone else’s Beam.'}</p></div>
                <button className={`toggle ${dataSaver ? 'on' : ''}`} type="button" role="switch" aria-checked={dataSaver} onClick={() => dataSaver ? setDataSaverMode(false) : setDataSaverWarningOpen(true)} aria-label="Toggle data saver"><span /></button>
              </div>
              <button className="settings-dialog__metrics" type="button" onClick={() => { setSettingsOpen(false); setMetricsOpen(true) }}><Activity size={17} /> Technical metrics</button>
            </motion.section>
          </motion.div>
        )}
        {dataSaverWarningOpen && (
          <motion.div className="dialog-backdrop" role="presentation" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={() => setDataSaverWarningOpen(false)}>
            <motion.section className="data-saver-dialog" role="dialog" aria-modal="true" aria-labelledby="data-saver-title" aria-describedby="data-saver-description" initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.98 }} onMouseDown={(event) => event.stopPropagation()}>
              <div className="data-saver-dialog__icon"><WifiOff size={20} aria-hidden="true" /></div>
              <h2 id="data-saver-title">Turn on data saver?</h2>
              <p id="data-saver-description">Your Beam experience will be noticeably worse. This setting affects only this browser, not anyone else in the Beam.</p>
              <ul><li>Turns off typing indicators.</li><li>Disables file sharing and automatically declines files sent to you.</li><li>Disables Canvas, including drawing sync and images.</li><li>Disables location sharing and map previews.</li><li>Limits messages you send or receive from compatible peers to 1,000 characters.</li><li>Asks compatible peers not to send you file, Canvas, or typing traffic.</li></ul>
              <div className="data-saver-dialog__actions"><button className="quiet-button" type="button" onClick={() => setDataSaverWarningOpen(false)}>Cancel</button><button className="primary small" type="button" onClick={() => { setDataSaverMode(true); setDataSaverWarningOpen(false) }}>Turn on data saver</button></div>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>

    </motion.section>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>
}

function TransferMetric({ transfer }: { transfer: TransferRecord }) {
  return <article className="transfer-metric"><div><strong>{transfer.name}</strong><span>{transfer.direction === 'sending' ? 'Sending' : 'Receiving'} · {transfer.status}</span></div><dl><Metric label="Size" value={formatBytes(transfer.size)} /><Metric label="Progress" value={`${Math.round(transfer.progress * 100)}%`} /><Metric label="Current speed" value={`${formatBytes(transfer.speed)}/s`} /><Metric label="Average speed" value={transfer.averageSpeed === undefined ? '—' : `${formatBytes(transfer.averageSpeed)}/s`} /><Metric label="Peak speed" value={transfer.peakSpeed === undefined ? '—' : `${formatBytes(transfer.peakSpeed)}/s`} /><Metric label="Elapsed" value={transfer.elapsedMs === undefined ? '—' : formatMilliseconds(transfer.elapsedMs)} /></dl></article>
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
      <article className={`feed-item feed-item--canvas ${item.received ? 'received-message' : 'sent-message'}`}>
        <div><span className="feed-item--canvas__icon"><Paintbrush size={17} /></span><strong>{item.value}</strong><span>{item.received ? `${item.sender} started a canvas` : 'You started a canvas'}</span></div>
        {onCanvasJoin && <button type="button" onClick={onCanvasJoin}>{item.received ? 'Join canvas' : 'Open canvas'}</button>}
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
