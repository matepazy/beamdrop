export type DeviceType = 'phone' | 'tablet' | 'computer'
export function inferDeviceType(): DeviceType {
  const ua = navigator.userAgent.toLowerCase()
  if (/ipad|tablet/.test(ua)) return 'tablet'
  if (/mobi|iphone|android/.test(ua)) return 'phone'
  return 'computer'
}
export function defaultDisplayName() {
  const adjectives = ['Bright', 'Calm', 'Clever', 'Gentle', 'Quick', 'Quiet', 'Sunny', 'Wild']
  const nouns = ['Badger', 'Comet', 'Finch', 'Fox', 'Heron', 'Lynx', 'Otter', 'Wren']
  const pick = <T,>(items: T[]) => items[Math.floor(Math.random() * items.length)]
  return `${pick(adjectives)} ${pick(nouns)}`
}
