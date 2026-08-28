import { AnimatePresence, motion } from 'framer-motion'
import { Activity, ChevronDown, Clipboard, Download, FileText, LockKeyhole, LogOut, MapPin, Plus, RefreshCw, Send, Settings, UserRound, UserRoundX, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CircleMarker, MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

import { formatBytes, hostnameFor, isUrl } from '../lib/format'
import { useBeam, type FeedItem, type TransferRecord } from '../hooks/useBeam'
import type { RtcDiagnostics } from '../lib/rtcDiagnostics'
import { WaitingPage } from './WaitingPage'

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
  const beam = useBeam(secret, password, displayName, isCreator)

  const [qrOpen, setQrOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [metricsOpen, setMetricsOpen] = useState(false)
  const [diagnostics, setDiagnostics] = useState<RtcDiagnostics[]>([])
  const [diagnosticsUpdatedAt, setDiagnosticsUpdatedAt] = useState<number | null>(null)
  const [passwordDraft, setPasswordDraft] = useState('')
  const [copied, setCopied] = useState(false)
  const [composer, setComposer] = useState('')
  const [attachmentsOpen, setAttachmentsOpen] = useState(false)
  const [participantsExpanded, setParticipantsExpanded] = useState(false)

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
  const connected = beam.state === 'connected'
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
    if (!metricsOpen) return

    let active = true
    const refresh = async () => {
      const next = await beam.getDiagnostics()
      if (!active) return
      setDiagnostics(next)
      setDiagnosticsUpdatedAt(Date.now())
    }

    void refresh()
    const interval = window.setInterval(() => void refresh(), 2_000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [metricsOpen])

  const recipient =
    beam.peers[0]?.name ?? 'your other device'

  const copy = async (value: string) => {
    await navigator.clipboard.writeText(value)

    setCopied(true)

    setTimeout(() => setCopied(false), 1600)
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
    if (!shareValue.trim()) return

    beam.sendItem(
      shareValue,
      isUrl(shareValue) ? 'link' : 'text',
    )
    clearComposer()
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
              value={displayName}
              onChange={(event) =>
                onRename(
                  event.target.value.slice(0, 48),
                )
              }
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

      <section ref={conversationRef} className="conversation" aria-label="Conversation">
        {hasActivity || beam.pendingPeers.length > 0 ? (
          <div className="conversation-feed">
            {activity.map((entry) => entry.type === 'transfer' ? (
              <TransferCard key={entry.transfer.id} item={entry.transfer} onAccept={() => beam.replyToOffer(entry.transfer.id, true)} onDecline={() => beam.replyToOffer(entry.transfer.id, false)} onCancel={() => beam.cancelTransfer(entry.transfer.id)} />
            ) : <FeedCard key={entry.item.id} item={entry.item} />)}
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
                <button type="button" role="menuitem" onClick={() => { setAttachmentsOpen(false); fileInput.current?.click() }}><FileText size={17} /> File</button>
                <button type="button" role="menuitem" onClick={addLocation}><MapPin size={17} /> Location</button>
                <button type="button" role="menuitem" onClick={() => { setAttachmentsOpen(false); void addClipboard() }}><Clipboard size={17} /> Paste</button>
              </div>}
            </div>
            <textarea
              ref={composerInput}
              value={composer}
              onChange={(event) => {
                setComposer(event.target.value)
                resizeComposer(event.currentTarget)
              }}
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
        {metricsOpen && (
          <motion.div className="dialog-backdrop" role="presentation" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={() => setMetricsOpen(false)}>
            <motion.section className="metrics-dialog" role="dialog" aria-modal="true" aria-labelledby="beam-metrics-title" initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.98 }} onMouseDown={(event) => event.stopPropagation()}>
              <div className="metrics-dialog__head"><div><Activity size={19} /><div><h2 id="beam-metrics-title">Technical metrics</h2></div></div><button type="button" onClick={() => setMetricsOpen(false)} aria-label="Close technical metrics"><X size={18} /></button></div>
              <div className="metrics-dialog__privacy"><LockKeyhole size={15} /> Candidate addresses are never shown.</div>
              {diagnostics.length > 0 ? <div className="metrics-peers">{diagnostics.map((diagnostic, index) => <section className="metrics-peer" key={diagnostic.peerId}><h3>{beam.peers[index]?.name ?? `Connected peer ${index + 1}`}</h3><dl><Metric label="Route" value={diagnostic.route === 'turn-relay' ? 'TURN relay' : titleCase(diagnostic.route)} /><Metric label="Transport" value={diagnostic.transport.toUpperCase()} /><Metric label="Round-trip time" value={formatMilliseconds(diagnostic.currentRoundTripTimeMs)} /><Metric label="Available uplink" value={formatBitrate(diagnostic.availableOutgoingBitrate)} /><Metric label="Bytes sent" value={formatBytesOrUnavailable(diagnostic.bytesSent)} /><Metric label="Bytes received" value={formatBytesOrUnavailable(diagnostic.bytesReceived)} /><Metric label="Local candidate" value={diagnostic.localCandidateType ?? 'Unavailable'} /><Metric label="Remote candidate" value={diagnostic.remoteCandidateType ?? 'Unavailable'} /></dl></section>)}</div> : <p className="metrics-empty">Connection data will appear once the browser publishes it.</p>}
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
              <button className="settings-dialog__metrics" type="button" onClick={() => { setSettingsOpen(false); setMetricsOpen(true) }}><Activity size={17} /> Technical metrics</button>
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
}: {
  item: FeedItem
}) {
  const location =
    item.kind === 'link'
      ? locationFromUrl(item.value)
      : null

  const timestamp = formatMessageTime(item.createdAt)

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

            {location && (
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
