import { motion } from 'framer-motion'
import { Check, Copy, LoaderCircle, LockKeyhole, QrCode, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'

const PASSWORD_FEATURE_ENABLED = false

export function WaitingPage({
  secret,
  state,
  peers,
  password,
  isCreator,
  passwordRequired,
  onPasswordChange,
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
  password: string
  isCreator: boolean
  passwordRequired: boolean
  onPasswordChange(password: string): void
  onCopy(value: string): void
  copied: boolean
  onQr(): void
  onEnd(): void
  qrOpen: boolean
  closeQr(): void
}) {
  const [passwordDraft, setPasswordDraft] = useState('')
  const [editingLock, setEditingLock] = useState(false)

  const joinUrl = useMemo(
    () =>
      `${location.origin}${location.pathname}#/join/${encodeURIComponent(secret)}`,
    [secret],
  )

  useEffect(() => {
    setPasswordDraft(password)
  }, [password])

  const label =
    state === 'failed'
      ? "Couldn't establish a connection."
      : state === 'password-required'
        ? 'This Beam is password protected.'
      : state === 'not-found'
        ? 'This Beam is not active. Check the code and try again.'
        : state === 'kicked'
          ? 'You were removed from this Beam.'
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
        <h2 className="waiting-title">
          {passwordRequired
            ? 'Enter password'
            : isCreator
              ? 'Share this code'
              : 'Joining Beam'}
        </h2>

        <h1>{secret}</h1>

        {PASSWORD_FEATURE_ENABLED && passwordRequired ? (
          <form
            className="password-panel"
            onSubmit={(event) => {
              event.preventDefault()
              if (passwordDraft.trim()) onPasswordChange(passwordDraft)
            }}
          >
            <p>Enter the password shared by the person who started this Beam.</p>
            <label htmlFor="beam-password">Password</label>
            <div className="password-panel__form">
              <input
                autoFocus
                id="beam-password"
                type="password"
                autoComplete="current-password"
                value={passwordDraft}
                onChange={(event) => setPasswordDraft(event.target.value)}
                placeholder="Enter password"
              />
              <button className="primary" disabled={!passwordDraft.trim()}>
                Join
              </button>
            </div>
          </form>
        ) : (
          <p className="share-instruction">
            {isCreator
              ? 'Send it to the device you want to connect.'
              : 'Looking for a Beam with this code.'}
          </p>
        )}

        <div className="waiting-actions">
          <button
            className="primary"
            onClick={() => onCopy(joinUrl)}
          >
            {copied ? (
              <Check size={17} />
            ) : (
              <Copy size={17} />
            )}

            {copied
              ? 'Link copied'
              : 'Copy link'}
          </button>

          <button
            className="qr-button"
            onClick={onQr}
            aria-label="Show QR code"
            title="Show QR code"
          >
            <QrCode size={17} />
            QR code
          </button>
        </div>

        {PASSWORD_FEATURE_ENABLED && isCreator && !passwordRequired && (
          <div className="lock-panel">
            {editingLock ? (
              <form
                className="password-panel"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (passwordDraft.trim()) {
                    onPasswordChange(passwordDraft)
                    setEditingLock(false)
                  }
                }}
              >
                <label htmlFor="beam-lock-password">Set a password</label>
                <div className="password-panel__form">
                  <input
                    autoFocus
                    id="beam-lock-password"
                    type="password"
                    autoComplete="new-password"
                    value={passwordDraft}
                    onChange={(event) => setPasswordDraft(event.target.value)}
                    placeholder="Choose a password"
                  />
                  <button className="primary" disabled={!passwordDraft.trim()}>
                    Save
                  </button>
                </div>
                <button
                  className="text-button lock-panel__cancel"
                  type="button"
                  onClick={() => {
                    setPasswordDraft(password)
                    setEditingLock(false)
                  }}
                >
                  Cancel
                </button>
              </form>
            ) : password ? (
              <div className="lock-panel__summary">
                <span><LockKeyhole size={16} /> Password protected</span>
                <div>
                  <button className="text-button" onClick={() => setEditingLock(true)}>Change</button>
                  <button className="text-button" onClick={() => onPasswordChange('')}>Remove</button>
                </div>
              </div>
            ) : (
              <button className="lock-panel__add" onClick={() => setEditingLock(true)}>
                <LockKeyhole size={16} /> Add password
              </button>
            )}
          </div>
        )}

        <div
          className={`connection ${state}`}
        >
          <LoaderCircle size={17} />
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

