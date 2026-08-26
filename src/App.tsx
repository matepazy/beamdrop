import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowDown,
  Check,
  Clipboard,
  Copy,
  FileText,
  Link2,
  LoaderCircle,
  LogOut,
  MapPin,
  Menu,
  Plus,
  QrCode,
  Send,
  WifiOff,
  X,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import {
  CircleMarker,
  MapContainer,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

import { generatePassphrase, isValidSecret, normalizeSecret } from './lib/codes'
import { formatBytes, hostnameFor, isUrl } from './lib/format'
import { defaultDisplayName } from './lib/device'
import { useBeam, type FeedItem, type TransferRecord } from './hooks/useBeam'

type View =
  | { mode: 'home' }
  | { mode: 'waiting'; secret: string }
  | { mode: 'room'; secret: string }
  | { mode: 'page'; page: 'guidelines' | 'privacy' }

function route(): View {
  if (location.pathname === '/guidelines') {
    return { mode: 'page', page: 'guidelines' }
  }

  if (location.pathname === '/privacy') {
    return { mode: 'page', page: 'privacy' }
  }

  const match = location.hash.match(/^#\/join\/(.+)$/)

  return match
    ? {
        mode: 'waiting',
        secret: decodeURIComponent(match[1]),
      }
    : {
        mode: 'home',
      }
}

function Logo() {
  return (
    <svg className="beam-logo" viewBox="0 0 178 40" aria-hidden="true">
      <text className="beam-logo__beam" x="0" y="30">
        beam
      </text>

      <text className="beam-logo__drop" x="88" y="30">
        Drop
      </text>

      <circle className="beam-logo__dot" cx="169" cy="26" r="4" />
    </svg>
  )
}

export function App() {
  const [view, setView] = useState<View>(route)
  const [launching, setLaunching] = useState(false)

  const [displayName, setDisplayName] = useState(
    () =>
      localStorage.getItem('beam:display-name') ||
      defaultDisplayName(),
  )

  const [online, setOnline] = useState(navigator.onLine)

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine)

    addEventListener('online', sync)
    addEventListener('offline', sync)

    return () => {
      removeEventListener('online', sync)
      removeEventListener('offline', sync)
    }
  }, [])

  const go = (next: Exclude<View, { mode: 'page' }>) => {
    setView(next)

    location.hash =
      next.mode === 'home'
        ? ''
        : `/join/${encodeURIComponent(next.secret)}`
  }

  const createBeam = (secret: string) => {
    if (launching) return

    setLaunching(true)

    const delay = matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 50
      : 520

    window.setTimeout(() => {
      go({
        mode: 'waiting',
        secret,
      })

      setLaunching(false)
    }, delay)
  }

  return (
    <main
      className={`app-shell ${
        view.mode === 'home'
          ? 'landing-shell'
          : view.mode === 'page'
            ? 'page-shell'
            : 'session-shell'
      }`}
    >
      {view.mode !== 'home' && view.mode !== 'page' && (
        <header className="topbar">
          <button
            className="wordmark"
            onClick={() => go({ mode: 'home' })}
            aria-label="Beam home"
          >
            <Logo />
          </button>
        </header>
      )}

      {!online && view.mode !== 'page' && (
        <div className="offline">
          <WifiOff size={16} />
          You’re offline. Beam needs internet to connect.
        </div>
      )}

      <AnimatePresence mode="wait">
        {view.mode === 'home' ? (
          <Home
            key="home"
            onCreate={createBeam}
            onJoin={(secret) =>
              go({
                mode: 'waiting',
                secret,
              })
            }
          />
        ) : view.mode === 'page' ? (
          <InfoPage key={view.page} page={view.page} />
        ) : (
          <BeamSession
            key={view.secret}
            secret={view.secret}
            displayName={displayName}
            onRename={(name) => {
              setDisplayName(name)
              localStorage.setItem('beam:display-name', name)
            }}
            onEnd={() => go({ mode: 'home' })}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {launching && (
          <motion.div
            className="beam-splash"
            initial={{
              clipPath: 'circle(0% at 50% 50%)',
            }}
            animate={{
              clipPath: 'circle(150% at 50% 50%)',
            }}
            exit={{
              opacity: 0,
            }}
            transition={{
              duration: 0.52,
              ease: [0.16, 1, 0.3, 1],
            }}
            aria-hidden="true"
          />
        )}
      </AnimatePresence>
    </main>
  )
}

function InfoPage({
  page,
}: {
  page: 'guidelines' | 'privacy'
}) {
  const isGuidelines = page === 'guidelines'

  return (
    <motion.section
      className="info-page"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
    >
      <header className="info-page__nav">
        <a className="info-page__brand" href="/" aria-label="Beam home">
          <Logo />
        </a>

        <a className="info-page__back" href="/">
          Back to Beam
        </a>
      </header>

      <div className="info-page__content">
        <h1>{isGuidelines ? 'Use it responsibly.' : 'A quiet privacy policy.'}</h1>

        {isGuidelines ? (
          <>
            <p>
              Please don’t use Beam for anything illegal, harmful, or abusive.
            </p>
            <p>
              Beam is a simple peer-to-peer sharing tool. We have no practical
              way to verify what people share, and we don’t have a way to
              enforce these guidelines. You’re responsible for how you use it
              and for the content you send.
            </p>
          </>
        ) : (
          <>
            <p>
              Beam does not have accounts, sign-in, email collection, or user
              profiles. We do not collect or store the files, notes, links, or
              other content you share through a Beam.
            </p>
            <p>
              We have no way to identify you from a Beam. There is no user ID,
              account, or identity record connecting a person to a Beam or to
              anything shared in it. Shared content travels between the people
              using the Beam; it is not sent to us for storage or inspection.
            </p>
            <h2>Analytics</h2>
            <p>
              We use Vercel Web Analytics only to understand aggregate site
              usage. It is designed to be anonymous, does not use cookies, and
              the analytics available to us are not associated with an
              identifiable person or IP address. Vercel may process limited,
              coarse information such as the page visited, referrer, browser,
              device, approximate location, and timestamp to provide those
              aggregate statistics.
            </p>
            <h2>Your rights</h2>
            <p>
              Because Beam does not maintain an identifiable user record, we
              generally cannot identify or retrieve data about a particular
              user. If you believe you have provided personal data to us or
              have a privacy question, please contact the project operator so
              we can assess your request.
            </p>
          </>
        )}
      </div>
    </motion.section>
  )
}

function Home({
  onCreate,
  onJoin,
}: {
  onCreate(secret: string): void
  onJoin(secret: string): void
}) {
  const [join, setJoin] = useState('')
  const details = useRef<HTMLElement>(null)

  const revealDetails = () =>
    details.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    })

  return (
    <motion.section
      className="home"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <section className="landing-hero">
        <div
          className="floating-nav"
          aria-label="Beam introduction"
        >
          <button
            className="brand-pill"
            onClick={() =>
              scrollTo({
                top: 0,
                behavior: 'smooth',
              })
            }
            aria-label="Beam home"
          >
            <Logo />
          </button>

          <InfoMenu />
        </div>

        <div className="hero-copy">
          <h1>
            Pass it on.
            <br />
            <em>Then it’s gone.</em>
          </h1>

          <p>
            Files, notes, and links travel from one browser to another.
            No account, no upload, no trace left behind.
          </p>
        </div>

        <div className="hero-actions">
          <button
            className="primary create-button"
            onClick={() => onCreate(generatePassphrase())}
          >
            Start a private Beam
            <Plus size={18} />
          </button>

          <div className="join-panel">
            <label htmlFor="beam-code">
              Already have a code?
            </label>

            <div className="join-form">
              <input
                id="beam-code"
                aria-label="Beam code or passphrase"
                value={join}
                onChange={(event) => setJoin(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === 'Enter' &&
                    isValidSecret(join)
                  ) {
                    onJoin(normalizeSecret(join))
                  }
                }}
                placeholder="Enter code or phrase"
              />

              <button
                className="join-button"
                disabled={!isValidSecret(join)}
                onClick={() =>
                  onJoin(normalizeSecret(join))
                }
              >
                Join
              </button>
            </div>
          </div>
        </div>

        <button
          className="scroll-cue"
          onClick={revealDetails}
        >
          Scroll down for more info
          <ArrowDown size={15} />
        </button>
      </section>

      <section
        className="how-it-works"
        ref={details}
        id="how-it-works"
      >
        <div className="section-intro">
          <p>How it works</p>

          <h2>
            The shortest path between two devices.
          </h2>

          <span>
            Beam creates a temporary private space for the exchange,
            then gets out of the way.
          </span>
        </div>

        <div className="process">
          <article>
            <b>01</b>

            <h3>Start a Beam</h3>

            <p>
              Create a private room in one tap. You get a short code
              that is easy to share.
            </p>
          </article>

          <article>
            <b>02</b>

            <h3>Meet in the same room</h3>

            <p>
              The other person joins with your code—on any modern
              browser, on any device.
            </p>
          </article>

          <article>
            <b>03</b>

            <h3>Send it directly</h3>

            <p>
              Your file, note, or link goes straight between browsers.
              Nothing is stored on our servers.
            </p>
          </article>
        </div>
      </section>

      <section className="closing">
        <h2>
          Pass it on.
          <br />
          Then it’s gone.
        </h2>

        <button
          className="primary"
          onClick={() => onCreate(generatePassphrase())}
        >
          Start sharing
          <Plus size={18} />
        </button>
      </section>

      <section className="technical" id="technical">
        <div className="technical__intro">
          <h2>Private by the shape of the system.</h2>

          <p>
            Beam uses the web platform’s peer-to-peer transport. There is no
            Beam account, file store, room directory, or session history to
            keep.
          </p>
        </div>

        <div className="transfer-path" aria-label="How a Beam connection works">
          <div className="transfer-path__step">
            <span className="transfer-path__index">01</span>
            <h3>One shared secret</h3>
            <p>
              Your code is normalized and hashed in the browser to create a
              private room identifier.
            </p>
          </div>

          <div className="transfer-path__step">
            <span className="transfer-path__index">02</span>
            <h3>A brief rendezvous</h3>
            <p>
              A public signaling tracker helps browsers with the same room
              identifier discover one another.
            </p>
          </div>

          <div className="transfer-path__step">
            <span className="transfer-path__index">03</span>
            <h3>A direct data channel</h3>
            <p>
              WebRTC carries your files, text, and links between browsers. The
              shared content is never uploaded to Beam.
            </p>
          </div>
        </div>

        <div className="technical__note">
          <span>Connection note</span>
          <p>
            WebRTC transport is browser-encrypted. On restrictive networks, an
            optional TURN provider may relay encrypted traffic so the peers can
            still connect.
          </p>
        </div>
      </section>

      <footer className="site-footer">
        <a className="site-footer__brand" href="/" aria-label="Beam home">
          <Logo />
        </a>

        <p>Private, temporary sharing between browsers.</p>

        <nav className="site-footer__links" aria-label="Footer navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#technical">Technical details</a>
          <a href="/privacy">Privacy</a>
          <a href="/guidelines">Guidelines</a>
          <a href="https://github.com/matepazy/beamdrop" target="_blank" rel="noreferrer">GitHub</a>
        </nav>
      </footer>
    </motion.section>
  )
}

function InfoMenu() {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const items = [
    {
      label: 'Github',
      href: 'https://github.com/matepazy/beamdrop',
      external: true,
    },
    {
      label: 'Usage Guidelines',
      href: '/guidelines',
    },
    {
      label: 'Privacy',
      href: '/privacy',
    },
    {
      label: 'Developer',
      href: 'https://matepazy.hu',
      external: true,
    },
  ]

  useEffect(() => {
    if (!open) return

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)

    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  return (
    <div
      className={`info-menu ${open ? 'open' : ''}`}
      ref={menuRef}
    >
      <button
        className="promise-pill"
        type="button"
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
      >
        Menu

        <AnimatePresence mode="wait" initial={false}>
          {open ? (
            <motion.span
              key="close"
              initial={{ opacity: 0, rotate: -90, scale: 0.8 }}
              animate={{ opacity: 1, rotate: 0, scale: 1 }}
              exit={{ opacity: 0, rotate: 90, scale: 0.8 }}
              transition={{ duration: 0.15 }}
              style={{ display: 'flex' }}
            >
              <X
                size={20}
                strokeWidth={2}
                aria-hidden="true"
              />
            </motion.span>
          ) : (
            <motion.span
              key="menu"
              initial={{ opacity: 0, rotate: 90, scale: 0.8 }}
              animate={{ opacity: 1, rotate: 0, scale: 1 }}
              exit={{ opacity: 0, rotate: -90, scale: 0.8 }}
              transition={{ duration: 0.15 }}
              style={{ display: 'flex' }}
            >
              <Menu
                size={20}
                strokeWidth={2}
                aria-hidden="true"
              />
            </motion.span>
          )}
        </AnimatePresence>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="info-menu__items"
            role="menu"
            aria-label="Beam information"
            initial={{
              opacity: 0,
              y: -8,
              scale: 0.97,
            }}
            animate={{
              opacity: 1,
              y: 0,
              scale: 1,
            }}
            exit={{
              opacity: 0,
              y: -6,
              scale: 0.98,
            }}
            transition={{
              duration: 0.16,
              ease: [0.16, 1, 0.3, 1],
            }}
          >
            {items.map((item) => (
              <a
                key={item.label}
                href={item.href}
                role="menuitem"
                target={item.external ? '_blank' : undefined}
                rel={item.external ? 'noopener noreferrer' : undefined}
                onClick={() => setOpen(false)}
              >
                {item.label}
              </a>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function BeamSession({
  secret,
  displayName,
  onRename,
  onEnd,
}: {
  secret: string
  displayName: string
  onRename(name: string): void
  onEnd(): void
}) {
  const beam = useBeam(secret, displayName)

  const [qrOpen, setQrOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [composer, setComposer] = useState('')

  const [composerMode, setComposerMode] = useState<
    'text' | 'link' | 'location'
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

  const openComposer = (
    mode: 'text' | 'link' | 'location',
  ) => {
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
      openComposer(isUrl(value) ? 'link' : 'text')
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
      <Waiting
        secret={secret}
        state={beam.state}
        peers={beam.peers.length}
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
          <h1>
            Connected with <span>{recipient}</span>
            <i />
          </h1>

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
          className="end-button"
          onClick={onEnd}
        >
          <LogOut size={16} />
          End
        </button>
      </div>

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
            placeholder={composerMode === 'link' ? 'Paste a link to send' : `Message ${recipient}`}
            aria-label="Message"
          />
        )}

        <div className="chat-composer__bottom">
          <div className="attachment-actions" aria-label="Attach or share">
            <button className="attachment-action" type="button" onClick={() => fileInput.current?.click()}><FileText size={17} /><span>File</span></button>
            <button className="attachment-action" type="button" onClick={() => openComposer('link')}><Link2 size={17} /><span>Link</span></button>
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

function Waiting({
  secret,
  state,
  peers,
  onCopy,
  copied,
  onQr,
  onEnd,
  qrOpen,
  closeQr,
}: {
  secret: string
  state: string
  peers: number
  onCopy(): void
  copied: boolean
  onQr(): void
  onEnd(): void
  qrOpen: boolean
  closeQr(): void
}) {
  const label =
    state === 'failed'
      ? "Couldn't establish a connection."
      : state === 'disconnected'
        ? 'Connection lost. Waiting to reconnect…'
        : peers
          ? 'Device found. Connecting…'
          : 'Waiting for someone to join…'

  return (
    <motion.section
      className="waiting"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1,
        display: 'grid',
        gridTemplateRows: 'minmax(0, 1fr) auto minmax(0, 1fr)',
        minHeight: '100svh',
        width: '100%',
        padding: '24px',
        boxSizing: 'border-box',
        overflowY: 'auto',
        pointerEvents: 'none',
      }}
      initial={{
        opacity: 0,
        y: 16,
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
        duration: 0.42,
        ease: [0.16, 1, 0.3, 1],
      }}
    >
      <div
        className="beam-card"
        style={{
          gridRow: 2,
          justifySelf: 'center',
          pointerEvents: 'auto',
        }}
      >
        <p className="waiting-lead">
          Your private Beam is ready.
        </p>

        <h1>{secret}</h1>

        <p className="share-instruction">
          Send this code to the other device. It joins the same temporary
          space.
        </p>

        <div className="waiting-actions">
          <button
            className="primary"
            onClick={onCopy}
          >
            {copied ? (
              <Check size={17} />
            ) : (
              <Copy size={17} />
            )}

            {copied
              ? 'Copied'
              : 'Copy code'}
          </button>

          <button onClick={onQr}>
            <QrCode size={17} />
            QR code
          </button>
        </div>

        <div
          className={`connection ${state}`}
        >
          <LoaderCircle size={19} />
          <strong>{label}</strong>
        </div>
      </div>

      <div
        style={{
          gridRow: 3,
          alignSelf: 'start',
          justifySelf: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 12,
          marginTop: 28,
          maxWidth: 620,
          textAlign: 'center',
          pointerEvents: 'auto',
        }}
      >
        <button
          className="text-button end-link"
          onClick={onEnd}
          style={{ margin: 0 }}
        >
          Cancel Beam
        </button>

        <p
          style={{
            margin: 0,
            fontSize: 12,
            lineHeight: 1.55,
            opacity: 0.58,
          }}
        >
          By using Beam, you agree to follow our{' '}
          <a
            href="/guidelines"
            style={{
              color: 'inherit',
              textDecoration: 'underline',
              textUnderlineOffset: 3,
            }}
          >
            Usage Guidelines
          </a>{' '}
          and accept our{' '}
          <a
            href="/privacy"
            style={{
              color: 'inherit',
              textDecoration: 'underline',
              textUnderlineOffset: 3,
            }}
          >
            Privacy Policy
          </a>
          .
        </p>
      </div>

      {qrOpen && (
        <div style={{ pointerEvents: 'auto' }}>
          <QrDialog
            secret={secret}
            onClose={closeQr}
          />
        </div>
      )}
    </motion.section>
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

function QrDialog({
  secret,
  onClose,
}: {
  secret: string
  onClose(): void
}) {
  const [dataUrl, setDataUrl] =
    useState('')

  const joinUrl = useMemo(
    () =>
      `${location.origin}${location.pathname}#/join/${encodeURIComponent(secret)}`,
    [secret],
  )

  useEffect(() => {
    void QRCode.toDataURL(
      joinUrl,
      {
        width: 260,
        margin: 1,
        color: {
          dark: '#111827',
          light: '#ffffff',
        },
      },
    ).then(setDataUrl)
  }, [joinUrl])

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={onClose}
    >
      <div
        className="qr-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Beam QR code"
        onMouseDown={(event) =>
          event.stopPropagation()
        }
      >
        <button
          className="close"
          onClick={onClose}
          aria-label="Close"
        >
          <X size={18} />
        </button>

        <h2>Scan to join</h2>

        {dataUrl && (
          <img
            src={dataUrl}
            alt={`QR code to join Beam ${secret}`}
          />
        )}

        <p>{secret}</p>
      </div>
    </div>
  )
}
