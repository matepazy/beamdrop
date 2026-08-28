const ADJECTIVES = [
  'amber', 'ancient', 'ardent', 'azure', 'brave', 'brisk', 'calm', 'candid', 'cedar', 'clever', 'coral', 'cosmic', 'crisp', 'dapper', 'dawn', 'deep',
  'eager', 'ember', 'fair', 'fierce', 'fluent', 'forest', 'gentle', 'golden', 'grand', 'happy', 'hidden', 'hollow', 'humble', 'ivory', 'jolly', 'keen',
  'lively', 'lunar', 'mellow', 'merry', 'misty', 'modern', 'nimble', 'noble', 'ocean', 'opal', 'patient', 'pearl', 'plucky', 'proud', 'quiet', 'rapid',
  'ready', 'river', 'royal', 'rustic', 'sable', 'sacred', 'sandy', 'sharp', 'silver', 'solar', 'steady', 'sunny', 'swift', 'tidy', 'velvet', 'vivid',
  'warm', 'wild', 'wise', 'witty', 'young', 'zephyr', 'bright', 'cobalt', 'daring', 'elated', 'fabled', 'glowing', 'honest', 'kindred', 'lucky', 'mighty',
]
const NOUNS = [
  'acorn', 'badger', 'beacon', 'bison', 'cedar', 'comet', 'coral', 'coyote', 'cricket', 'falcon', 'fern', 'firefly', 'fox', 'harbor', 'heron', 'island',
  'jaguar', 'juniper', 'kingfisher', 'lantern', 'lark', 'maple', 'mango', 'meadow', 'meteor', 'narwhal', 'oak', 'oasis', 'otter', 'panda', 'parrot', 'pebble',
  'pine', 'quartz', 'rabbit', 'raven', 'reef', 'river', 'robin', 'saffron', 'sailor', 'sparrow', 'summit', 'tiger', 'valley', 'willow', 'wolf', 'wren',
  'yarrow', 'zebra', 'albatross', 'aster', 'bamboo', 'brook', 'canyon', 'dolphin', 'elm', 'ember', 'finch', 'glacier', 'horizon', 'iris', 'kestrel', 'lagoon',
  'lynx', 'marigold', 'moonstone', 'nectar', 'orion', 'poppy', 'redwood', 'sequoia', 'thistle', 'violet', 'watershed', 'zenith', 'aurora', 'clover', 'driftwood', 'hummingbird',
]

function randomIndex(length: number) {
  const ceiling = 65536 - (65536 % length)
  const value = new Uint16Array(1)
  do crypto.getRandomValues(value); while (value[0] >= ceiling)
  return value[0] % length
}

/** A human-readable Beam join code with substantially broader word vocabulary. */
export function generatePassphrase() {
  return `${ADJECTIVES[randomIndex(ADJECTIVES.length)]}-${NOUNS[randomIndex(NOUNS.length)]}-${String(randomIndex(100)).padStart(2, '0')}`
}
export const generateCode = generatePassphrase

export function normalizeSecret(value: string) {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '-').replace(/-+/g, '-')
  return normalized.replace(/^(.*)-(\d)$/, '$1-0$2')
}

export function secretFromJoinInput(value: string) {
  const input = value.trim()
  try { const url = new URL(input); const match = url.hash.match(/^#\/join\/([^/]+)$/); return match ? decodeURIComponent(match[1]) : input } catch { return input }
}

export function isValidSecret(value: string) {
  const [adjective, noun, number, ...extra] = normalizeSecret(value).split('-')
  return extra.length === 0 && ADJECTIVES.includes(adjective) && NOUNS.includes(noun) && /^\d{2}$/.test(number ?? '')
}

export async function roomIdFor(secret: string) { const { roomId } = await import('./crypto').then(({ deriveRoomMaterial }) => deriveRoomMaterial(secret)); return roomId }
