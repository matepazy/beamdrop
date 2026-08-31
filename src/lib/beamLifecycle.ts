import type { ConnectionState, TransferRecord } from '../hooks/useBeam'

export type BeamLifecycleStatus = 'ready' | 'background' | 'reconnecting' | 'interrupted' | 'offline'

export type BeamLifecycleSnapshot = {
  visible: boolean
  online: boolean
  connectionState: ConnectionState
  activeTransfers: number
  interruptedTransfers: number
}

export type BeamLifecycleNotice = {
  status: BeamLifecycleStatus
  label: string
  detail: string
}

export function summarizeTransfers(transfers: TransferRecord[]) {
  return {
    activeTransfers: transfers.filter(transfer => transfer.status === 'active').length,
    interruptedTransfers: transfers.filter(transfer => transfer.status === 'interrupted').length,
  }
}

/** Maps browser lifecycle and in-memory peer state to honest, user-facing copy. */
export function beamLifecycleNotice(snapshot: BeamLifecycleSnapshot): BeamLifecycleNotice {
  if (!snapshot.visible) return {
    status: 'background',
    label: 'Beam is in the background',
    detail: 'The browser decides whether a peer connection can keep running. Keep large transfers in the foreground.',
  }
  if (!snapshot.online) return {
    status: 'offline',
    label: 'You’re offline',
    detail: 'Beam will check the connection again when your device is online.',
  }
  if (snapshot.interruptedTransfers > 0) return {
    status: 'interrupted',
    label: 'Transfer interrupted',
    detail: 'A transfer stopped before completion. Files are not saved for later resume; send it again when connected.',
  }
  if (['waiting', 'peer-found', 'connecting', 'disconnected'].includes(snapshot.connectionState)) return {
    status: 'reconnecting',
    label: 'Reconnecting',
    detail: 'Beam is checking its peer connection. Background continuation depends on the device and browser.',
  }
  return { status: 'ready', label: 'Beam is ready', detail: '' }
}

export function shouldReconcileOnLifecycleEvent(visible: boolean, online: boolean) {
  return visible && online
}
