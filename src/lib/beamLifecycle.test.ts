import { describe, expect, it } from 'vitest'
import { beamLifecycleNotice, shouldReconcileOnLifecycleEvent, summarizeTransfers } from './beamLifecycle'
import type { TransferRecord } from '../hooks/useBeam'

describe('beam lifecycle status', () => {
  it('prioritises an honest background notice', () => {
    expect(beamLifecycleNotice({ visible: false, online: true, connectionState: 'connected', activeTransfers: 1, interruptedTransfers: 0 }).status).toBe('background')
  })

  it('reports interrupted transfers after returning to the foreground', () => {
    expect(beamLifecycleNotice({ visible: true, online: true, connectionState: 'disconnected', activeTransfers: 0, interruptedTransfers: 1 })).toMatchObject({ status: 'interrupted', label: 'Transfer interrupted' })
  })

  it('only reconciles while foregrounded and online', () => {
    expect(shouldReconcileOnLifecycleEvent(true, true)).toBe(true)
    expect(shouldReconcileOnLifecycleEvent(false, true)).toBe(false)
    expect(shouldReconcileOnLifecycleEvent(true, false)).toBe(false)
  })

  it('counts only active and interrupted transfers', () => {
    expect(summarizeTransfers([
      { status: 'active' }, { status: 'interrupted' }, { status: 'complete' },
    ] as TransferRecord[])).toEqual({ activeTransfers: 1, interruptedTransfers: 1 })
  })
})
