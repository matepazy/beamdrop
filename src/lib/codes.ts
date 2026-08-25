const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const ADJECTIVES = ['amber', 'brisk', 'calm', 'clever', 'crisp', 'dapper', 'gentle', 'lunar', 'mellow', 'nimble', 'quiet', 'rapid', 'silver', 'sunny', 'velvet', 'wild']
const NOUNS = ['badger', 'beacon', 'cedar', 'comet', 'falcon', 'harbor', 'mango', 'maple', 'otter', 'panda', 'river', 'saffron', 'sparrow', 'summit', 'tiger', 'willow']

function randomIndex(length: number) {
  const max = 256 - (256 % length)
  const byte = new Uint8Array(1)
  do crypto.getRandomValues(byte); while (byte[0] >= max)
  return byte[0] % length
}

export function generateCode() {
  const chars = Array.from({ length: 8 }, () => ALPHABET[randomIndex(ALPHABET.length)]).join('')
  return `${chars.slice(0, 4)}-${chars.slice(4)}`
}

export function generatePassphrase() {
  return `${ADJECTIVES[randomIndex(ADJECTIVES.length)]}-${NOUNS[randomIndex(NOUNS.length)]}-${String(randomIndex(100)).padStart(2, '0')}`
}

export function normalizeSecret(value: string) {
  const trimmed = value.trim().toLowerCase().replace(/\s+/g, ' ')
  const compact = trimmed.replace(/[\s-]/g, '')
  if (/^[abcdefghjkmnpqrstuvwxyz23456789]{8}$/.test(compact)) return `${compact.slice(0, 4)}-${compact.slice(4)}`.toUpperCase()
  return trimmed
}

export function isValidSecret(value: string) {
  if (/[\u0000-\u001f]/.test(value)) return false
  const normalized = normalizeSecret(value)
  return normalized.length >= 3 && normalized.length <= 96
}

export async function roomIdFor(secret: string) {
  const bytes = new TextEncoder().encode(`beam-room-v1:${normalizeSecret(secret)}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
