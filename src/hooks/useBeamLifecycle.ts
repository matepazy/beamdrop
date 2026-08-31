import { useEffect, useRef, useState } from 'react'
import { beamLifecycleNotice, shouldReconcileOnLifecycleEvent, summarizeTransfers } from '../lib/beamLifecycle'
import type { ConnectionState, TransferRecord } from './useBeam'

type BeamLifecycleOptions = {
  connectionState: ConnectionState
  transfers: TransferRecord[]
  onReconcile(): void
}

/**
 * Observes browser lifecycle events without trying to defeat browser or OS
 * suspension policies. It never closes a room or retries on a background timer.
 */
export function useBeamLifecycle({ connectionState, transfers, onReconcile }: BeamLifecycleOptions) {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible')
  const [online, setOnline] = useState(() => navigator.onLine)
  const reconcileRef = useRef(onReconcile)
  reconcileRef.current = onReconcile

  useEffect(() => {
    const reconcile = () => {
      const nextVisible = document.visibilityState === 'visible'
      const nextOnline = navigator.onLine
      setVisible(nextVisible)
      setOnline(nextOnline)
      if (shouldReconcileOnLifecycleEvent(nextVisible, nextOnline)) reconcileRef.current()
    }
    const onPageHide = () => setVisible(false)
    const onOffline = () => setOnline(false)

    document.addEventListener('visibilitychange', reconcile)
    window.addEventListener('pageshow', reconcile)
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('online', reconcile)
    window.addEventListener('offline', onOffline)
    return () => {
      document.removeEventListener('visibilitychange', reconcile)
      window.removeEventListener('pageshow', reconcile)
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('online', reconcile)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  const counts = summarizeTransfers(transfers)
  return {
    isForeground: visible,
    notice: beamLifecycleNotice({ visible, online, connectionState, ...counts }),
  }
}
