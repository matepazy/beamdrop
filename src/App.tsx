import { AnimatePresence, motion } from 'framer-motion'
import { WifiOff } from 'lucide-react'
import { useEffect, useState } from 'react'

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
            key={view.secret}
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

