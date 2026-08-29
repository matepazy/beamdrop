/** Peer-authentication compatibility. This is deliberately independent of app/package versions. */
export const BEAM_PROTOCOL_VERSION = 1

export function isCompatibleProtocol(version: unknown): version is typeof BEAM_PROTOCOL_VERSION {
  return version === BEAM_PROTOCOL_VERSION
}
