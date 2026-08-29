export const PREPARED_CHUNK_COUNT = 6
export const PROGRESS_UPDATE_INTERVAL_MS = 100

/**
 * The sender owns one File and a separate lifecycle for every recipient.  A
 * transfer may only release its File after every recipient is terminal.
 */
export type RecipientTransferStatus =
  | 'offered'
  | 'accepted'
  | 'transferring'
  | 'completed'
  | 'cancelled'
  | 'rejected'
  | 'failed'

export type RecipientTransferState = {
  peerId: string
  status: RecipientTransferStatus
  bytesSent: number
  abortController?: AbortController
}

export type OutgoingTransfer = {
  id: string
  file: File
  recipients: Map<string, RecipientTransferState>
}

export const isRecipientTerminal = (status: RecipientTransferStatus) =>
  ['completed', 'cancelled', 'rejected', 'failed'].includes(status)

export const areAllRecipientsTerminal = (transfer: OutgoingTransfer) =>
  [...transfer.recipients.values()].every(recipient =>
    isRecipientTerminal(recipient.status),
  )

export type TransferMeasurement = {
  bytes: number
  elapsedMs: number
  speed: number
  averageSpeed: number
  peakSpeed: number
}

/**
 * Keeps transfer measurements stable enough for UI updates while retaining the
 * exact byte count for completion and diagnostics.
 */
export function createTransferMeter(startedAt = performance.now()) {
  let lastBytes = 0
  let lastMeasuredAt = startedAt
  let smoothedSpeed = 0
  let peakSpeed = 0

  return (bytes: number, now = performance.now()): TransferMeasurement => {
    const elapsedMs = Math.max(now - startedAt, 1)
    const intervalMs = Math.max(now - lastMeasuredAt, 1)
    const instantSpeed = Math.max(0, bytes - lastBytes) / intervalMs * 1_000

    // An exponential moving average avoids a noisy per-chunk speed display.
    smoothedSpeed = smoothedSpeed
      ? smoothedSpeed * 0.72 + instantSpeed * 0.28
      : instantSpeed
    peakSpeed = Math.max(peakSpeed, instantSpeed)
    lastBytes = bytes
    lastMeasuredAt = now

    return {
      bytes,
      elapsedMs,
      speed: smoothedSpeed,
      averageSpeed: bytes / elapsedMs * 1_000,
      peakSpeed,
    }
  }
}

export function shouldReportProgress(
  lastReportedAt: number,
  now = performance.now(),
) {
  return now - lastReportedAt >= PROGRESS_UPDATE_INTERVAL_MS
}
