export type RtcDiagnostics = {
  peerId: string
  route: 'direct' | 'turn-relay' | 'unknown'
  transport: 'udp' | 'tcp' | 'unknown'
  localCandidateType: string | null
  remoteCandidateType: string | null
  currentRoundTripTimeMs: number | null
  availableBandwidth: number | null
  bytesSent: number | null
  bytesReceived: number | null
}

export type ConnectionHealth = {
  tone: 'good' | 'caution' | 'problem'
  label: string
  guidance: string
}

type StatsWithType = RTCStats & {
  localCandidateId?: string
  remoteCandidateId?: string
  state?: string
  nominated?: boolean
  selected?: boolean
  candidateType?: string
  protocol?: string
  currentRoundTripTime?: number
  availableOutgoingBitrate?: number
  availableIncomingBitrate?: number
  bytesSent?: number
  bytesReceived?: number
}

const numeric = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

/**
 * Estimates the usable link bandwidth by taking the limiting direction of the
 * selected WebRTC path. Some browsers publish only the outbound estimate; in
 * that case it remains the best available measurement for this peer-to-peer
 * connection.
 */
export function calculateAvailableBandwidth(
  outgoingBitrate: number | null,
  incomingBitrate: number | null,
) {
  if (outgoingBitrate === null) return incomingBitrate
  if (incomingBitrate === null) return outgoingBitrate
  return Math.min(outgoingBitrate, incomingBitrate)
}

/** Converts a completed peer probe into bits per second. */
export function calculateMeasuredBandwidth(bytes: number, elapsedMs: number) {
  if (!Number.isFinite(bytes) || bytes <= 0 || !Number.isFinite(elapsedMs) || elapsedMs <= 0) return null
  return bytes * 8_000 / elapsedMs
}

/** Returns route details without exposing candidate IP addresses. */
export async function getRtcDiagnostics(
  peerId: string,
  peer: RTCPeerConnection,
): Promise<RtcDiagnostics> {
  const stats = await peer.getStats()
  const entries = [...stats.values()] as StatsWithType[]
  const pair = entries.find(entry =>
    entry.type === 'candidate-pair' &&
    entry.state === 'succeeded' &&
    (entry.nominated || entry.selected),
  )
  const local = pair?.localCandidateId
    ? entries.find(entry => entry.id === pair.localCandidateId)
    : undefined
  const remote = pair?.remoteCandidateId
    ? entries.find(entry => entry.id === pair.remoteCandidateId)
    : undefined
  const transport = local?.protocol?.toLowerCase()
  const localCandidateType = local?.candidateType ?? null
  const remoteCandidateType = remote?.candidateType ?? null
  const isRelay = localCandidateType === 'relay' || remoteCandidateType === 'relay'

  return {
    peerId,
    route: pair ? isRelay ? 'turn-relay' : 'direct' : 'unknown',
    transport: transport === 'udp' || transport === 'tcp' ? transport : 'unknown',
    localCandidateType,
    remoteCandidateType,
    currentRoundTripTimeMs: numeric(pair?.currentRoundTripTime) === null
      ? null
      : numeric(pair?.currentRoundTripTime)! * 1_000,
    availableBandwidth: calculateAvailableBandwidth(
      numeric(pair?.availableOutgoingBitrate),
      numeric(pair?.availableIncomingBitrate),
    ),
    bytesSent: numeric(pair?.bytesSent),
    bytesReceived: numeric(pair?.bytesReceived),
  }
}

export async function getRoomDiagnostics(
  peers: Record<string, RTCPeerConnection>,
) {
  const results = await Promise.allSettled(
    Object.entries(peers).map(([peerId, peer]) =>
      getRtcDiagnostics(peerId, peer),
    ),
  )

  return results.flatMap(result =>
    result.status === 'fulfilled' ? [result.value] : [],
  )
}

/** A privacy-safe, user-facing reading of the currently selected WebRTC route. */
export function connectionHealth(
  diagnostics: RtcDiagnostics[],
): ConnectionHealth {
  if (!diagnostics.length) {
    return {
      tone: 'caution',
      label: 'Checking connection',
      guidance: 'Connection details will appear after the browsers finish negotiating.',
    }
  }

  if (diagnostics.some(diagnostic => diagnostic.route === 'unknown')) {
    return {
      tone: 'caution',
      label: 'Connection details unavailable',
      guidance: 'The connection is active, but this browser has not published route details yet.',
    }
  }

  const worstLatency = Math.max(
    ...diagnostics.map(diagnostic => diagnostic.currentRoundTripTimeMs ?? 0),
  )
  const usesRelay = diagnostics.some(diagnostic => diagnostic.route === 'turn-relay')

  if (worstLatency >= 500) {
    return {
      tone: 'problem',
      label: 'Unstable connection',
      guidance: 'The route is responding slowly. Keep both browsers open and try a stronger network before sending a large file.',
    }
  }

  if (usesRelay) {
    return {
      tone: 'caution',
      label: 'Connected through a relay',
      guidance: 'Your content remains browser-encrypted, but this network route can be slower than a direct connection.',
    }
  }

  return {
    tone: 'good',
    label: worstLatency >= 250 ? 'Connected, slower route' : 'Direct connection',
    guidance: worstLatency >= 250
      ? 'This connection should work, though large transfers may take longer than usual.'
      : 'The browsers are connected directly and ready to share.',
  }
}
