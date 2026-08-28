import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, Check, ExternalLink, LockKeyhole, Network, ShieldCheck, WifiOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import { defaultDisplayName } from './lib/device'
import { ConnectedPage } from './components/ConnectedPage'
import { LandingPage } from './components/LandingPage'
import { Logo } from './components/Brand'

type View =
  | { mode: 'home' }
  | { mode: 'waiting'; secret: string; password: string; isCreator: boolean }
  | { mode: 'room'; secret: string; password: string; isCreator: boolean }
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
        password: '',
        isCreator: false,
      }
    : {
        mode: 'home',
      }
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

  const createBeam = (secret: string, password: string) => {
    if (launching) return

    setLaunching(true)

    const delay = matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 50
      : 520

    window.setTimeout(() => {
      go({
        mode: 'waiting',
        secret,
        password,
        isCreator: true,
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
          <LandingPage
            key="home"
            onCreate={createBeam}
            onJoin={(secret) =>
              go({
                mode: 'waiting',
                secret,
                password: '',
                isCreator: false,
              })
            }
          />
        ) : view.mode === 'page' ? (
          <InfoPage key={view.page} page={view.page} />
        ) : (
          <ConnectedPage
            // A password submission must create a fresh Trystero handshake.
            // Keeping only the room code as the key left the rejected room
            // mounted and made the password form appear to do nothing.
            key={`${view.secret}:${view.password}`}
            secret={view.secret}
            password={view.password}
            isCreator={view.isCreator}
            displayName={displayName}
            onRename={(name) => {
              setDisplayName(name)
              localStorage.setItem('beam:display-name', name)
            }}
            onEnd={() => go({ mode: 'home' })}
            onPasswordChange={(password) =>
              go({
                mode: 'waiting',
                secret: view.secret,
                password,
                isCreator: view.isCreator,
              })
            }
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
  const title = isGuidelines ? 'Use it responsibly.' : 'Privacy, without the fog.'
  const description = isGuidelines
    ? 'A few clear expectations for using a private sharing space well.'
    : 'What the official Beam site processes, what stays in your browser, and who else may see connection data.'

  return (
    <motion.section
      className={`info-page info-page--${page}`}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
    >
      <header className="info-page__nav">
        <a className="info-page__brand" href="/" aria-label="Beam home">
          <Logo />
        </a>

        <a className="info-page__back" href="/">
          <ArrowLeft size={16} aria-hidden="true" />
          Back to Beam
        </a>
      </header>

      <header className="info-page__hero">
        <div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </header>

      {isGuidelines ? <Guidelines /> : <PrivacyPolicy />}
    </motion.section>
  )
}

function Guidelines() {
  return <div className="info-page__reading">
    <article className="info-page__article">
      <p className="info-page__lede">Beam is an open-source, browser-to-browser sharing tool. These guidelines apply to the official Beam site and app. If you run your own copy, you are responsible for its operation and rules.</p>
      <PolicySection id="share" title="Share with permission" icon={<Check size={18} />}><p>You are responsible for the files, links, text, clipboard contents, and locations you send or receive. Get permission before sharing another person’s personal data, confidential information, or copyrighted material.</p><p>Do not use Beam to break the law, infringe rights, distribute malware, evade sanctions, facilitate fraud, harass, impersonate, spam, or overload networks. Never use Beam to create, request, distribute, or promote child sexual abuse material; report it to the appropriate authorities.</p></PolicySection>
      <PolicySection id="private" title="Keep the room private" icon={<LockKeyhole size={18} />}><p>A Beam code, passphrase, password, or QR link can allow someone to try to join a Beam. Share them only with intended participants, use a strong optional password for sensitive exchanges, and end the Beam when you are done.</p><p>Peer-to-peer is not a promise that the people you invite are trustworthy. Recipients can save, copy, forward, or screen-record what they receive. Treat unexpected files and links with care.</p></PolicySection>
      <PolicySection id="limits" title="Know the limits" icon={<Network size={18} />}><p>Beam is provided on an “as is” and “as available” basis under the repository’s AGPL-3.0 license. It is not a backup, archival, emergency, or guaranteed-delivery service. Transfers may fail, and the project operator cannot inspect, recover, or moderate peer-to-peer content.</p><p>Forks and self-hosted deployments are independent services. Their operators—not the Beam project operator—are responsible for their privacy notices, legal obligations, infrastructure, and moderation decisions.</p></PolicySection>
    </article>
  </div>
}

function PrivacyPolicy() {
  return <div className="info-page__reading">
    <article className="info-page__article">
      <PolicySection id="basics" title="The basics" icon={<ShieldCheck size={18} />}><p>The data controller for the official hosted Beam site is the BeamDrop Project Operator. For privacy or data-rights requests, write to <a href="mailto:contact@beamdrop.link">contact@beamdrop.link</a>. Please do not include a Beam secret, password, or shared content. No data-protection officer has been appointed.</p><p>Beam has no accounts or user profiles. It does not collect email addresses, use advertising cookies, run analytics, or store shared files, notes, links, clipboard contents, locations, Beam secrets, or session history. Content moves between participating browsers, not through a Beam content server.</p><p>If you choose a display name, it is saved only in your browser’s local storage so the app can reuse it on that device. It is not transmitted to the project operator and can be removed by clearing the site’s storage.</p></PolicySection>
      <PolicySection id="providers" title="Providers you may connect to" icon={<Network size={18} />}><p>These providers support the official deployment or a feature you choose to use. They may receive the information needed to provide their service, usually IP address, browser or device details, requested resource, time, and network or security metadata.</p><Provider name="Vercel" detail="Hosts and delivers the official static site." privacy="https://vercel.com/legal/privacy-notice" terms="https://vercel.com/legal/terms" /><Provider name="Cloudflare" detail="Provides domain, DNS, and web-network services for the official domain." privacy="https://www.cloudflare.com/policies/privacy/" terms="https://www.cloudflare.com/policies/terms/" /><Provider name="Porkbun" detail="Registers the beamdrop.link domain." privacy="https://porkbun.com/legal/agreement/privacy_policy" terms="https://porkbun.com/legal/agreement/product_terms_of_service" /><Provider name="Google STUN" detail="Helps establish WebRTC connections through stun.l.google.com:19302." privacy="https://policies.google.com/privacy" terms="https://www.about.google/policies/terms/" /><Provider name="Public Nostr relays" detail="Provide peer discovery through Trystero’s Nostr adapter. Nostr is decentralised and Beam does not control these relays. Each relay can publish its own terms under NIP-11; it receives a hashed room identifier and connection metadata, not the readable Beam secret." privacy="https://nips.nostr.com/11" terms="https://nips.nostr.com/11" /><Provider name="OpenStreetMap" detail="Supplies map tiles only when a map is shown or a location is composed." privacy="https://osmfoundation.org/wiki/Privacy_Policy" terms="https://operations.osmfoundation.org/policies/tiles/" /><p>GitHub and the project operator’s website are optional external links; they are contacted only if you open them. See <a href="https://docs.github.com/en/site-policy/privacy-policies" target="_blank" rel="noreferrer">GitHub Privacy</a> and <a href="https://docs.github.com/en/site-policy/github-terms/github-terms-of-service" target="_blank" rel="noreferrer">GitHub Terms</a>.</p></PolicySection>
      <PolicySection id="rights" title="Your data rights" icon={<LockKeyhole size={18} />}><p>Where the project operator processes limited hosting or security data, the legal basis is the legitimate interest in delivering and protecting the official site (GDPR Article 6(1)(f)). The optional local display-name preference is stored at your direction. Beam does not make automated decisions about you or sell personal data for marketing.</p><p>Subject to the GDPR and applicable limits, you may request access, correction, erasure, restriction, portability, or object to processing based on legitimate interests. You may also complain to your local data-protection authority. Beam usually cannot identify you or retrieve a particular Beam because it keeps no account or content record.</p><p>Network, relay, map, DNS, registrar, and hosting providers set their own retention and may process data outside the EEA; consult their linked notices. A self-hosted copy may use different providers. Any deployment that enables an optional TURN credential endpoint or TURN relay must disclose that provider before use.</p><p>Beam is not designed to collect children’s personal data. We may update this notice when the app, hosting, or providers change.</p></PolicySection>
    </article>
  </div>
}

function PolicySection({ id, title, icon, children }: { id: string; title: string; icon: ReactNode; children: ReactNode }) {
  return <section className="policy-section" id={id}><h2><span>{icon}</span>{title}</h2>{children}</section>
}

function Provider({ name, detail, privacy, terms }: { name: string; detail: string; privacy: string; terms: string }) {
  return <section className="provider"><div><h3>{name}</h3><p>{detail}</p></div><p className="provider__links"><a href={privacy} target="_blank" rel="noreferrer">Privacy <ExternalLink size={13} aria-hidden="true" /></a><a href={terms} target="_blank" rel="noreferrer">Terms <ExternalLink size={13} aria-hidden="true" /></a></p></section>
}
