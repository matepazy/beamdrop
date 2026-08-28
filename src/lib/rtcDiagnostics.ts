export type RtcDiagnostics = {
  peerId: string
  route: 'direct' | 'turn-relay' | 'unknown'
  transport: 'udp' | 'tcp' | 'unknown'
  localCandidateType: string | null
  remoteCandidateType: string | null
  currentRoundTripTimeMs: number | null
  availableOutgoingBitrate: number | null
  bytesSent: number | null
  bytesReceived: number | null
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
  bytesSent?: number
  bytesReceived?: number
}

const numeric = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

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
    availableOutgoingBitrate: numeric(pair?.availableOutgoingBitrate),
    bytesSent: numeric(pair?.bytesSent),
    bytesReceived: numeric(pair?.bytesReceived),
  }
}

export async function getRoomDiagnostics(
  peers: Record<string, RTCPeerConnection>,
) {
  return Promise.all(
    Object.entries(peers).map(([peerId, peer]) =>
      getRtcDiagnostics(peerId, peer),
    ),
  )
}
