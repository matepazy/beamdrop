import { decodeBase64Url, evaluateRelease, isReleaseEnvelope, localReleaseEnvelope, REQUIRE_OFFICIAL_RELEASE, type ReleaseVerification } from './releaseVerification'
import type { ReleaseEnvelope } from './releaseMetadata'
import { BEAM_PROTOCOL_VERSION, isCompatibleProtocol } from './protocolVersion'

const encoder = new TextEncoder()
const NONCE_BYTES = 32
const MAX_HANDSHAKE_MESSAGE_BYTES = 8 * 1024

type AuthChallenge = { type: 'auth-challenge'; protocol: number; nonce: string; appVersion: string; release: ReleaseEnvelope | null }
type AuthResponse = { type: 'auth-response'; protocol: number; nonce: string; proof: string; appVersion: string; release: ReleaseEnvelope | null }
type HandshakeMessage = AuthChallenge | AuthResponse
export type HandshakeReceive = () => Promise<{ data: unknown }>
export type HandshakeSend = (data: HandshakeMessage) => Promise<void>
export type PeerAuthResult = { release: ReleaseVerification }

const base64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
const nonce = () => base64Url(crypto.getRandomValues(new Uint8Array(NONCE_BYTES)))
const byteLength = (value: unknown) => { try { return encoder.encode(JSON.stringify(value)).byteLength } catch { return Infinity } }

function isChallenge(value: unknown): value is AuthChallenge {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const m = value as Record<string, unknown>
  return m.type === 'auth-challenge' && Number.isSafeInteger(m.protocol) && typeof m.nonce === 'string' && decodeBase64Url(m.nonce)?.byteLength === NONCE_BYTES && typeof m.appVersion === 'string' && m.appVersion.length <= 64 && (m.release === null || isReleaseEnvelope(m.release))
}
function isResponse(value: unknown): value is AuthResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const m = value as Record<string, unknown>
  return m.type === 'auth-response' && Number.isSafeInteger(m.protocol) && typeof m.nonce === 'string' && decodeBase64Url(m.nonce)?.byteLength === NONCE_BYTES && typeof m.proof === 'string' && decodeBase64Url(m.proof)?.byteLength === 32 && typeof m.appVersion === 'string' && m.appVersion.length <= 64 && (m.release === null || isReleaseEnvelope(m.release))
}
function parseHandshake(value: unknown): HandshakeMessage {
  if (byteLength(value) > MAX_HANDSHAKE_MESSAGE_BYTES || (!isChallenge(value) && !isResponse(value))) throw new Error('invalid peer authentication message')
  if (!isCompatibleProtocol(value.protocol)) throw new Error('incompatible peer protocol')
  return value
}

export function peerAuthMacInput({ roomId, challengeRole, challengeNonce, protocol = BEAM_PROTOCOL_VERSION }: { roomId: string; challengeRole: 'initiator-challenge' | 'responder-challenge'; challengeNonce: string; protocol?: number }) {
  return encoder.encode(`beamdrop-peer-auth-v1\nprotocol=${protocol}\nroom=${roomId}\nrole=${challengeRole}\nnonce=${challengeNonce}\n`)
}
export async function createPeerAuthProof(key: CryptoKey, input: Parameters<typeof peerAuthMacInput>[0]) {
  return base64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, peerAuthMacInput(input))))
}
export async function verifyPeerAuthProof(key: CryptoKey, input: Parameters<typeof peerAuthMacInput>[0], proof: unknown) {
  const signature = decodeBase64Url(proof)
  return Boolean(signature && await crypto.subtle.verify('HMAC', key, signature, peerAuthMacInput(input)))
}

async function receiveMessage(receive: HandshakeReceive) { return parseHandshake((await receive()).data) }
async function requireRelease(release: ReleaseEnvelope | null) {
  const result = await evaluateRelease(release)
  if (!result.officialRelease && REQUIRE_OFFICIAL_RELEASE) throw new Error('official release verification required')
  return result
}

/** Mutual, nonce-bound HMAC authentication executed before Trystero activates a peer. */
export async function authenticatePeer({ roomId, authenticationKey, send, receive, isInitiator, appVersion = '0.1.0' }: { roomId: string; authenticationKey: CryptoKey; send: HandshakeSend; receive: HandshakeReceive; isInitiator: boolean; appVersion?: string }): Promise<PeerAuthResult> {
  const release = localReleaseEnvelope()
  if (isInitiator) {
    const challengeNonce = nonce()
    await send({ type: 'auth-challenge', protocol: BEAM_PROTOCOL_VERSION, nonce: challengeNonce, appVersion, release })
    const response = await receiveMessage(receive)
    if (response.type !== 'auth-response' || response.nonce !== challengeNonce || !await verifyPeerAuthProof(authenticationKey, { roomId, challengeRole: 'initiator-challenge', challengeNonce }, response.proof)) throw new Error('peer authentication failed')
    const peerRelease = await requireRelease(response.release)
    const peerChallenge = await receiveMessage(receive)
    if (peerChallenge.type !== 'auth-challenge') throw new Error('peer authentication failed')
    await send({ type: 'auth-response', protocol: BEAM_PROTOCOL_VERSION, nonce: peerChallenge.nonce, proof: await createPeerAuthProof(authenticationKey, { roomId, challengeRole: 'responder-challenge', challengeNonce: peerChallenge.nonce }), appVersion, release })
    return { release: peerRelease }
  }
  const peerChallenge = await receiveMessage(receive)
  if (peerChallenge.type !== 'auth-challenge') throw new Error('peer authentication failed')
  const peerRelease = await requireRelease(peerChallenge.release)
  const challengeNonce = nonce()
  await send({ type: 'auth-response', protocol: BEAM_PROTOCOL_VERSION, nonce: peerChallenge.nonce, proof: await createPeerAuthProof(authenticationKey, { roomId, challengeRole: 'initiator-challenge', challengeNonce: peerChallenge.nonce }), appVersion, release })
  await send({ type: 'auth-challenge', protocol: BEAM_PROTOCOL_VERSION, nonce: challengeNonce, appVersion, release })
  const response = await receiveMessage(receive)
  if (response.type !== 'auth-response' || response.nonce !== challengeNonce || !await verifyPeerAuthProof(authenticationKey, { roomId, challengeRole: 'responder-challenge', challengeNonce }, response.proof)) throw new Error('peer authentication failed')
  await requireRelease(response.release)
  return { release: peerRelease }
}
