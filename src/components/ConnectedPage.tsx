import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, Clipboard, FileText, Link2, LogOut, MapPin, Send, Settings, UserRound, UserRoundX, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CircleMarker, MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

import { formatBytes, hostnameFor, isUrl } from '../lib/format'
import { useBeam, type FeedItem, type TransferRecord } from '../hooks/useBeam'
import { WaitingPage } from './WaitingPage'

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
  const [passwordDraft, setPasswordDraft] = useState('')
  const [copied, setCopied] = useState(false)
  const [composer, setComposer] = useState('')
  const [participantsExpanded, setParticipantsExpanded] = useState(
    () =>
      typeof window === 'undefined' ||
      !window.matchMedia('(max-width: 620px)').matches,
  )

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
  const conversationRef = useRef<HTMLElement>(null)
  const connected = beam.state === 'connected'
  const activityCount = beam.feed.length + beam.transfers.length

  useLayoutEffect(() => {
    if (connected && conversationRef.current) {
      conversationRef.current.scrollTop =
        conversationRef.current.scrollHeight
    }
  }, [activityCount, connected])

  const recipient =
    beam.peers[0]?.name ?? 'your other device'

  const copy = async () => {
    await navigator.clipboard.writeText(secret)

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

  const addLocation = () =>
    openComposer('location')

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
          <ChevronDown className="participants__chevron" size={17} aria-hidden="true" />
        </summary>
        <div className="participants__list">
          <span className="participant"><i /> You</span>
          {beam.peers.map((peer) => <span className="participant" key={peer.id}><i /> {peer.name}<button type="button" onClick={() => beam.kickPeer(peer.id)} aria-label={`Remove ${peer.name}`}><UserRoundX size={15} /> Remove</button></span>)}
        </div>
        {beam.pendingPeers.length > 0 && <div className="join-requests"><strong>Join requests</strong>{beam.pendingPeers.map((peer) => <div key={peer.id}><span>{peer.name} wants to join</span><button className="primary small" type="button" onClick={() => beam.admitPeer(peer.id)}>Allow</button></div>)}</div>}
      </details>

      <section ref={conversationRef} className="conversation" aria-label="Conversation">
        {hasActivity ? (
          <div className="conversation-feed">
            {activity.map((entry) => entry.type === 'transfer' ? (
              <TransferCard key={entry.transfer.id} item={entry.transfer} recipient={recipient} onAccept={() => beam.replyToOffer(entry.transfer.id, true)} onDecline={() => beam.replyToOffer(entry.transfer.id, false)} onCancel={() => beam.cancelTransfer(entry.transfer.id)} />
            ) : <FeedCard key={entry.item.id} item={entry.item} />)}
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
          <textarea
            ref={composerInput}
            value={composer}
            onChange={(event) => setComposer(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                sendMessage()
              }
            }}
            placeholder={`Message ${recipient}`}
            aria-label="Message"
          />
        )}

        <div className="chat-composer__bottom">
          <div className="attachment-actions" aria-label="Attach or share">
            <button className="attachment-action" type="button" onClick={() => fileInput.current?.click()}><FileText size={17} /><span>File</span></button>
            <button className="attachment-action" type="button" onClick={addLocation}><MapPin size={17} /><span>Location</span></button>
            <button className="attachment-action" type="button" onClick={() => void addClipboard()}><Clipboard size={17} /><span>Paste</span></button>
          </div>
          <button className="send-message" disabled={!shareValue.trim()} type="submit" aria-label="Send message"><Send size={18} /><span>Send</span></button>
        </div>
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
                  <form className="settings-dialog__section" onSubmit={(event) => {
                    event.preventDefault()
                    onPasswordChange(passwordDraft)
                    setSettingsOpen(false)
                  }}>
                    <div><strong>Password</strong><p>Changes apply to new joiners only. People already connected stay in this Beam.</p></div>
                    <label htmlFor="settings-password">New password <span>(leave blank to remove)</span></label>
                    <div className="settings-dialog__password"><input id="settings-password" type="password" autoComplete="new-password" value={passwordDraft} onChange={(event) => setPasswordDraft(event.target.value)} placeholder="No password" /><button className="primary" type="submit">Save</button></div>
                  </form>

                  <div className="settings-dialog__section settings-dialog__toggle">
                    <div><strong>Free for ALL</strong><p>Anyone with the Beam code can join instantly. No approval is needed after the first member joins.</p></div>
                    <button className={`toggle ${beam.freeForAll ? 'on' : ''}`} type="button" role="switch" aria-checked={beam.freeForAll} onClick={() => beam.setFreeForAll(!beam.freeForAll)}><span /></button>
                  </div>
                </>
              ) : (
                <p className="settings-dialog__note">Only the person who started this Beam can change its password or joining mode.</p>
              )}
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>

    </motion.section>
  )
}

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
  recipient,
  onAccept,
  onDecline,
  onCancel,
}: {
  item: TransferRecord
  recipient: string
  onAccept(): void
  onDecline(): void
  onCancel(): void
}) {
  const needsReply =
    item.direction === 'receiving' &&
    item.status === 'offered'

  return (
    <motion.article
      className={`transfer-card ${item.direction === 'receiving' ? 'received-message' : 'sent-message'}`}
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
            {formatBytes(item.size)} ·{' '}
            {item.direction ===
            'sending'
              ? `To ${recipient}`
              : `From ${item.sender}`} · {formatMessageTime(item.createdAt)}
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
            <div className="progress">
              <i
                style={{
                  transform: `scaleX(${item.progress})`,
                }}
              />
            </div>

            <div className="transfer-meta">
              <span>
                {item.status ===
                'complete'
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
  return (
    <article className={`feed-item ${item.received ? 'received-message' : 'sent-message'}`}>
      <div className="feed-icon">
        {item.kind === 'file' ? (
          <FileText size={17} />
        ) : item.kind === 'link' ? (
          <Link2 size={17} />
        ) : (
          <FileText size={17} />
        )}
      </div>

      <div>
        <strong>
          {item.kind === 'link'
            ? hostnameFor(item.value)
            : item.value}
        </strong>

        <span>
          {item.received ? `From ${item.sender}` : 'You'} · {formatMessageTime(item.createdAt)}
          {item.size
            ? ` · ${formatBytes(item.size)}`
            : ''}
        </span>
      </div>

      {item.kind === 'file' &&
      item.objectUrl ? (
        <a
          href={item.objectUrl}
          download={item.value}
        >
          Save
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
  )
}

function formatMessageTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(timestamp)
}
