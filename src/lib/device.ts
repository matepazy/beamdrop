export type DeviceType = 'phone' | 'tablet' | 'computer'
export function inferDeviceType(): DeviceType {
  const ua = navigator.userAgent.toLowerCase()
  if (/ipad|tablet/.test(ua)) return 'tablet'
  if (/mobi|iphone|android/.test(ua)) return 'phone'
  return 'computer'
}
export function defaultDisplayName() {
  const type = inferDeviceType()
  return type === 'phone' ? 'My phone' : type === 'tablet' ? 'My tablet' : 'My computer'
}
