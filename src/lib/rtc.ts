export async function getRtcConfig(): Promise<RTCConfiguration> {
  const fallback: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
  const endpoint = import.meta.env.VITE_TURN_CREDENTIAL_ENDPOINT as string | undefined
  if (!endpoint) return fallback
  try {
    const response = await fetch(endpoint, { credentials: 'omit' })
    if (!response.ok) return fallback
    const config = await response.json() as RTCConfiguration
    return { ...fallback, ...config }
  } catch { return fallback }
}
