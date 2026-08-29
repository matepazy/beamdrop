import { LOCAL_RELEASE_MANIFEST, LOCAL_RELEASE_SIGNATURE, OFFICIAL_RELEASE_PUBLIC_JWK, type ReleaseEnvelope, type ReleaseManifest } from './releaseMetadata'
import { BEAM_PROTOCOL_VERSION } from './protocolVersion'

export const REQUIRE_OFFICIAL_RELEASE = false

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })
const base64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')

export function decodeBase64Url(value: unknown): Uint8Array | null {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length > 1024) return null
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)
    const decoded = Uint8Array.from(atob(padded), char => char.charCodeAt(0))
    return base64Url(decoded) === value ? decoded : null
  } catch { return null }
}

export function isReleaseManifest(value: unknown): value is ReleaseManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const manifest = value as Record<string, unknown>
  return manifest.product === 'beamdrop' && typeof manifest.version === 'string' && manifest.version.length > 0 && manifest.version.length <= 64 &&
    Number.isSafeInteger(manifest.protocol) && typeof manifest.commit === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(manifest.commit) &&
    typeof manifest.builtAt === 'string' && manifest.builtAt.length > 0 && manifest.builtAt.length <= 64
}

export function isReleaseEnvelope(value: unknown): value is ReleaseEnvelope {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && isReleaseManifest((value as Record<string, unknown>).manifest) && decodeBase64Url((value as Record<string, unknown>).signature))
}

/** Stable, explicit serialization: do not sign JSON.stringify on arbitrary objects. */
export function canonicalReleaseManifest(manifest: ReleaseManifest) {
  return `beamdrop-release-v1\nproduct=${manifest.product}\nversion=${manifest.version}\nprotocol=${manifest.protocol}\ncommit=${manifest.commit}\nbuiltAt=${manifest.builtAt}\n`
}

export async function verifyReleaseEnvelope(envelope: unknown, publicKey: JsonWebKey | null = OFFICIAL_RELEASE_PUBLIC_JWK) {
  if (!isReleaseEnvelope(envelope) || !publicKey) return false
  try {
    const key = await crypto.subtle.importKey('jwk', publicKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, decodeBase64Url(envelope.signature)!, encoder.encode(canonicalReleaseManifest(envelope.manifest)))
  } catch { return false }
}

export function localReleaseEnvelope(): ReleaseEnvelope | null {
  return LOCAL_RELEASE_SIGNATURE ? { manifest: LOCAL_RELEASE_MANIFEST, signature: LOCAL_RELEASE_SIGNATURE } : null
}

export type ReleaseVerification = { officialRelease: boolean; releaseSignatureValid: boolean; verifiedReleaseManifest: ReleaseManifest | null }
export async function evaluateRelease(envelope: unknown): Promise<ReleaseVerification> {
  const releaseSignatureValid = await verifyReleaseEnvelope(envelope)
  return { officialRelease: releaseSignatureValid, releaseSignatureValid, verifiedReleaseManifest: releaseSignatureValid ? (envelope as ReleaseEnvelope).manifest : null }
}

export const releaseManifestBytes = (manifest: ReleaseManifest) => encoder.encode(canonicalReleaseManifest(manifest))
export const decodeReleaseTextForTests = (value: Uint8Array) => decoder.decode(value)
export const localProtocolMatches = () => LOCAL_RELEASE_MANIFEST.protocol === BEAM_PROTOCOL_VERSION
