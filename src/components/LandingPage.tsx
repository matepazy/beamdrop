import { motion } from 'framer-motion'
import { ArrowDown, Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { generatePassphrase, isValidSecret, normalizeSecret } from '../lib/codes'
import { InfoMenu, Logo } from './Brand'

export function LandingPage({
  onCreate,
  onJoin,
}: {
  onCreate(secret: string, password: string): void
  onJoin(secret: string): void
}) {
  const [join, setJoin] = useState('')
  const [navOnDarkSurface, setNavOnDarkSurface] = useState(false)
  const details = useRef<HTMLElement>(null)
  const create = () => onCreate(generatePassphrase(), '')

  useEffect(() => {
    const darkSections = () =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          '.how-it-works, .closing, .site-footer',
        ),
      )

    const syncNavContrast = () => {
      const navY = 48
      const isOverDarkSection = darkSections().some((section) => {
        const { top, bottom } = section.getBoundingClientRect()
        return top <= navY && bottom >= navY
      })

      setNavOnDarkSurface(isOverDarkSection)
    }

    syncNavContrast()
    addEventListener('scroll', syncNavContrast, { passive: true })
    addEventListener('resize', syncNavContrast)

    return () => {
      removeEventListener('scroll', syncNavContrast)
      removeEventListener('resize', syncNavContrast)
    }
  }, [])

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
          className={`floating-nav${navOnDarkSurface ? ' floating-nav--on-dark' : ''}`}
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
            onClick={create}
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
          onClick={create}
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
              Public signaling relays help browsers with the same room
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

