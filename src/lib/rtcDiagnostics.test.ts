import { describe, expect, it } from 'vitest'

import { connectionHealth, type RtcDiagnostics } from './rtcDiagnostics'

const diagnostic = (
  change: Partial<RtcDiagnostics> = {},
): RtcDiagnostics => ({
  peerId: 'peer',
  route: 'direct',
  transport: 'udp',
  localCandidateType: 'host',
  remoteCandidateType: 'srflx',
  currentRoundTripTimeMs: 42,
  availableOutgoingBitrate: 1_000_000,
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
