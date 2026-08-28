const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()
const IV_LENGTH = 12

/** Derives a session-only key. The password is never sent to signaling relays or peers. */
export async function encryptionKeyFor(secret: string, password = ''): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', textEncoder.encode(`${secret}\u0000${password}`), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: textEncoder.encode('beamdrop-message-encryption-v1'), iterations: 210_000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

/** A non-reversible proof used to check a join password without sending it. */
export async function passwordProofFor(secret: string, password: string): Promise<string> {
  const bytes = textEncoder.encode(`${secret}\u0000${password}`)
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function encryptBytes(key: CryptoKey, bytes: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes))
  const result = new Uint8Array(iv.length + encrypted.length)
  result.set(iv); result.set(encrypted, iv.length)
  return result
}

export async function decryptBytes(key: CryptoKey, value: unknown): Promise<Uint8Array | null> {
  const bytes = value instanceof Uint8Array ? value : value instanceof ArrayBuffer ? new Uint8Array(value) : null
  if (!bytes || bytes.length <= IV_LENGTH) return null
  try { return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, IV_LENGTH) }, key, bytes.subarray(IV_LENGTH))) } catch { return null }
}

export async function encryptMessage(key: CryptoKey, value: unknown) { return encryptBytes(key, textEncoder.encode(JSON.stringify(value))) }
export async function decryptMessage(key: CryptoKey, value: unknown) {
  const bytes = await decryptBytes(key, value)
  if (!bytes) return null
  try { return JSON.parse(textDecoder.decode(bytes)) as unknown } catch { return null }
}
