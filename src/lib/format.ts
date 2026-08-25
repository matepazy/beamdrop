export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const level = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** level
  return `${value >= 10 || level === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[level]}`
}

export function hostnameFor(value: string) {
  try { return new URL(value).hostname.replace(/^www\./, '') } catch { return value }
}

export function isUrl(value: string) {
  try { const url = new URL(value.trim()); return url.protocol === 'http:' || url.protocol === 'https:' } catch { return false }
}
