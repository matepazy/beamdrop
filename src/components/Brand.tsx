import { AnimatePresence, motion } from 'framer-motion'
import { Menu, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

export function Logo() {
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

export function InfoMenu() {
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

    const shouldLockScroll = matchMedia('(max-width: 819px)').matches

    if (shouldLockScroll) {
      document.body.classList.add('menu-open')
    }

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

      if (shouldLockScroll) {
        document.body.classList.remove('menu-open')
      }
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
        {open ? 'Close' : 'Menu'}

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
          <motion.button
            className="info-menu__backdrop"
            type="button"
            tabIndex={-1}
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          />
        )}
      </AnimatePresence>

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
            {items.map((item, index) => (
              <motion.a
                key={item.label}
                href={item.href}
                role="menuitem"
                target={item.external ? '_blank' : undefined}
                rel={item.external ? 'noopener noreferrer' : undefined}
                onClick={() => setOpen(false)}
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 6 }}
                transition={{
                  duration: 0.2,
                  delay: index * 0.04,
                  ease: [0.22, 1, 0.36, 1],
                }}
              >
                {item.label}
              </motion.a>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

