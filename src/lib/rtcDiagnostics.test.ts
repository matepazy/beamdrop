import { describe, expect, it } from 'vitest'

import { calculateAvailableBandwidth, calculateMeasuredBandwidth, connectionHealth, type RtcDiagnostics } from './rtcDiagnostics'

const diagnostic = (
  change: Partial<RtcDiagnostics> = {},
): RtcDiagnostics => ({
  peerId: 'peer',
  route: 'direct',
  transport: 'udp',
  localCandidateType: 'host',
  remoteCandidateType: 'srflx',
  currentRoundTripTimeMs: 42,
  availableBandwidth: 1_000_000,
  bytesSent: 0,
  bytesReceived: 0,
  ...change,
})

describe('connectionHealth', () => {
  it('explains a direct, responsive connection', () => {
    expect(connectionHealth([diagnostic()])).toMatchObject({
      tone: 'good',
      label: 'Direct connection',
    })
  })

  it('calls out a relayed route without treating it as a failure', () => {
    expect(connectionHealth([diagnostic({ route: 'turn-relay' })])).toMatchObject({
      tone: 'caution',
      label: 'Connected through a relay',
    })
  })

  it('warns before large transfers on high latency routes', () => {
    expect(connectionHealth([diagnostic({ currentRoundTripTimeMs: 700 })])).toMatchObject({
      tone: 'problem',
      label: 'Unstable connection',
    })
  })
})

describe('calculateAvailableBandwidth', () => {
  it('uses the slower direction as the connection bandwidth', () => {
    expect(calculateAvailableBandwidth(8_000_000, 3_000_000)).toBe(3_000_000)
  })

  it('falls back to the estimate a browser provides', () => {
    expect(calculateAvailableBandwidth(8_000_000, null)).toBe(8_000_000)
    expect(calculateAvailableBandwidth(null, 3_000_000)).toBe(3_000_000)
    expect(calculateAvailableBandwidth(null, null)).toBeNull()
  })
})

describe('calculateMeasuredBandwidth', () => {
  it('converts a completed probe into a bitrate', () => {
    expect(calculateMeasuredBandwidth(125_000, 200)).toBe(5_000_000)
  })

  it('rejects invalid probe measurements', () => {
    expect(calculateMeasuredBandwidth(0, 200)).toBeNull()
    expect(calculateMeasuredBandwidth(125_000, 0)).toBeNull()
  })
})
