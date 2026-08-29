import { BEAM_PROTOCOL_VERSION } from './protocolVersion'

export type ReleaseManifest = {
  product: 'beamdrop'
  version: string
  protocol: number
  commit: string
  builtAt: string
}

export type ReleaseEnvelope = { manifest: ReleaseManifest; signature: string }

/**
 * Release automation may replace these constants at build time. Only a public
 * verification key and a signature belong in the static frontend; never add a
 * release-signing private key here.
 */
export const OFFICIAL_RELEASE_PUBLIC_JWK: JsonWebKey | null = null
export const LOCAL_RELEASE_MANIFEST: ReleaseManifest = {
  product: 'beamdrop', version: '0.1.0', protocol: BEAM_PROTOCOL_VERSION, commit: 'development', builtAt: 'development',
}
export const LOCAL_RELEASE_SIGNATURE: string | null = null
