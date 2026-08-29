import { motion, useReducedMotion } from 'framer-motion'
import type { MotionProps } from 'framer-motion'
import { ArrowDown, ArrowRight, Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { generatePassphrase, isValidSecret, normalizeSecret, secretFromJoinInput } from '../lib/codes'
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
  const reduceMotion = useReducedMotion()
  const create = () => onCreate(generatePassphrase(), '')
  const joinSecret = secretFromJoinInput(join)
  const isJoinValid = isValidSecret(joinSecret)

  const submitJoin = () => {
    if (isJoinValid) onJoin(normalizeSecret(joinSecret))
  }

  useEffect(() => {
    const darkSections = () =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          '[data-nav-contrast="light"]',
        ),
      )

    const syncNavContrast = () => {
      const navBounds = document.querySelector('.floating-nav')?.getBoundingClientRect()
      const navY = navBounds ? navBounds.top + navBounds.height / 2 : 48
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

  const enter = (delay = 0): MotionProps =>
    reduceMotion
      ? {}
      : {
          initial: { opacity: 0, y: 18 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.55, delay, ease: 'circOut' },
        }

  return (
    <motion.section
      className="home"
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={reduceMotion ? undefined : { opacity: 1 }}
      exit={reduceMotion ? undefined : { opacity: 0 }}
    >
      <div className="nav-blur" aria-hidden="true" />

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

      <section className="landing-hero">
        <motion.div className="hero-copy" {...enter(0.08)}>

          <h1>
            Pass it on.
            <br />
            <em>Then it’s gone.</em>
          </h1>

          <p>
            <span>Files, notes, and links travel from one browser to another.</span>
            <span>No account, no upload, no trace left behind.</span>
          </p>
        </motion.div>

        <motion.div className="hero-actions" {...enter(0.18)}>
          <button
            className="primary create-button"
            onClick={create}
          >
            Start a private Beam
            <Plus size={18} />
          </button>

          <div className="join-panel">
            <label htmlFor="beam-code">
              Have a Beam link or code?
            </label>

            <form
              className={`join-form${isJoinValid ? ' join-form--ready' : ''}`}
              onSubmit={(event) => {
                event.preventDefault()
                submitJoin()
              }}
            >
              <input
                id="beam-code"
                aria-label="Beam link, code, or passphrase"
                aria-describedby={
                  join.length > 0 && !isJoinValid
                    ? 'beam-code-help'
                    : undefined
                }
                aria-invalid={join.length > 0 && !isJoinValid}
                autoComplete="off"
                spellCheck={false}
                value={join}
                onChange={(event) => setJoin(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && isJoinValid) {
                    event.preventDefault()
                    submitJoin()
                  }
                }}
                placeholder="Paste link or enter code"
              />

              <button
                className="join-button"
                type="submit"
                disabled={!isJoinValid}
              >
                Join
                {isJoinValid && <ArrowRight size={16} aria-hidden="true" />}
              </button>
            </form>

            {join.length > 0 && !isJoinValid && (
              <p className="join-help" id="beam-code-help" role="status">
                Paste a Beam link or enter the complete code to join.
              </p>
            )}
          </div>
        </motion.div>

        <motion.button
          className="scroll-cue"
          onClick={revealDetails}
          {...enter(0.3)}
        >
          Scroll down for more info
          <ArrowDown size={15} />
        </motion.button>
      </section>

      <section
        className="how-it-works"
        ref={details}
        id="how-it-works"
        data-nav-contrast="light"
      >
        <motion.div className="section-intro" {...enter()}>
          <p>How it works</p>

          <h2>
            The shortest path between two devices.
          </h2>

          <span>
            Beam creates a temporary private space for the exchange,
            then gets out of the way.
          </span>
        </motion.div>

        <motion.div className="process" {...enter(0.08)}>
          <motion.article whileHover={reduceMotion ? undefined : { y: -4 }} transition={{ duration: 0.2 }}>
            <b>01</b>

            <h3>Start a Beam</h3>

            <p>
              Create a private room in one tap. You get a short code
              that is easy to share.
            </p>
          </motion.article>

          <motion.article whileHover={reduceMotion ? undefined : { y: -4 }} transition={{ duration: 0.2 }}>
            <b>02</b>

            <h3>Meet in the same room</h3>

            <p>
              The other person joins with your code—on any modern
              browser, on any device.
            </p>
          </motion.article>

          <motion.article whileHover={reduceMotion ? undefined : { y: -4 }} transition={{ duration: 0.2 }}>
            <b>03</b>

            <h3>Send it directly</h3>

            <p>
              Your file, note, or link goes straight between browsers.
              Nothing is stored on our servers.
            </p>
          </motion.article>
        </motion.div>
      </section>

      <section className="closing" data-nav-contrast="light">
        <h2>
          Send it fast.
          <br />
          Nothing lasts.
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
        <motion.div className="technical__intro" {...enter()}>
          <h2>Private by the shape of the system.</h2>

          <p>
            Beam uses the web platform’s peer-to-peer transport. There is no
            Beam account, file store, room directory, or session history to
            keep.
          </p>
        </motion.div>

        <motion.div className="transfer-path" aria-label="How a Beam connection works" {...enter(0.08)}>
          <motion.div className="transfer-path__step" whileHover={reduceMotion ? undefined : { x: 4 }} transition={{ duration: 0.2 }}>
            <span className="transfer-path__index">01</span>
            <h3>One shared secret</h3>
            <p>
              Your code is normalized and hashed in the browser to create a
              private room identifier.
            </p>
          </motion.div>

          <motion.div className="transfer-path__step" whileHover={reduceMotion ? undefined : { x: 4 }} transition={{ duration: 0.2 }}>
            <span className="transfer-path__index">02</span>
            <h3>A brief rendezvous</h3>
            <p>
              Public signaling relays help browsers with the same room
              identifier discover one another.
            </p>
          </motion.div>

          <motion.div className="transfer-path__step" whileHover={reduceMotion ? undefined : { x: 4 }} transition={{ duration: 0.2 }}>
            <span className="transfer-path__index">03</span>
            <h3>A direct data channel</h3>
            <p>
              WebRTC carries your files, text, and links between browsers. The
              shared content is never uploaded to Beam.
            </p>
          </motion.div>
        </motion.div>

        <div className="technical__note">
          <span>Connection note</span>
          <p>
            WebRTC transport is browser-encrypted. On restrictive networks, an
            optional TURN provider may relay encrypted traffic so the peers can
            still connect.
          </p>
        </div>
      </section>

      <footer className="site-footer" data-nav-contrast="light">
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
