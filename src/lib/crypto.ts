const encoder = new TextEncoder()

/**
 * `appKey` remains reserved for a defined application-payload encryption format.
 * It must never be reused for peer authentication.
 */
export type RoomMaterial = { roomId: string; signalingKey: string; appKey: CryptoKey; authenticationKey: CryptoKey }

function base64Url(bytes: Uint8Array) {
  let binary = ''
  bytes.forEach(byte => { binary += String.fromCharCode(byte) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function randomCapability(bytes = 18) { return base64Url(crypto.getRandomValues(new Uint8Array(bytes))) }

export async function deriveRoomMaterial(capability: string): Promise<RoomMaterial> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(capability), 'HKDF', false, ['deriveBits', 'deriveKey'])
  const deriveBits = async (info: string) => new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: encoder.encode('beamdrop/v2'), info: encoder.encode(info) }, material, 256))
  const [roomIdBytes, signalingBytes, appKey, authenticationKey] = await Promise.all([
    deriveBits('beam-room-id'), deriveBits('beam-signaling-key'),
    crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: encoder.encode('beamdrop/v2'), info: encoder.encode('beamdrop-encryption-v1') }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']),
    crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: encoder.encode('beamdrop/v2'), info: encoder.encode('beamdrop-peer-auth-v1') }, material, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign', 'verify']),
  ])
  return { roomId: base64Url(roomIdBytes), signalingKey: base64Url(signalingBytes), appKey, authenticationKey }
}

export async function passwordResponse(capability: string, password: string, nonce: Uint8Array): Promise<string> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey'])
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: encoder.encode(`beam-password/v2/${capability}`), iterations: 310_000, hash: 'SHA-256' }, material, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign'])
  return base64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, nonce)))
}

export function timingSafeEqual(a: string, b: string) { if (a.length !== b.length) return false; let result = 0; for (let index = 0; index < a.length; index += 1) result |= a.charCodeAt(index) ^ b.charCodeAt(index); return result === 0 }

/** WebRTC DataChannels already authenticate and encrypt payload transport. The
 * capability-derived signaling key gates rendezvous/Trystero actions; appKey is
 * intentionally reserved for a future defined end-to-end feature, not password-based encryption. */
