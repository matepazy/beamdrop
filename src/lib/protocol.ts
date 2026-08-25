export type PeerHello = { type: 'hello'; name: string; deviceType: 'phone' | 'tablet' | 'computer' }
export type SharedText = { type: 'item'; item: { id: string; kind: 'text' | 'link'; value: string; createdAt: number } }
export type FileOffer = { type: 'file-offer'; transferId: string; name: string; size: number; mimeType: string; totalChunks: number }
export type FileReply = { type: 'file-accept' | 'file-decline' | 'file-cancel'; transferId: string }
export type FileComplete = { type: 'file-complete'; transferId: string }
export type BeamMessage = PeerHello | SharedText | FileOffer | FileReply | FileComplete

const MAX_CONTROL_SIZE = 16_000
export function parseMessage(input: unknown): BeamMessage | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const message = input as Record<string, unknown>
  if (JSON.stringify(message).length > MAX_CONTROL_SIZE || typeof message.type !== 'string') return null
  if (message.type === 'hello' && typeof message.name === 'string' && ['phone', 'tablet', 'computer'].includes(String(message.deviceType))) return message as PeerHello
  if (message.type === 'item' && message.item && typeof message.item === 'object') {
    const item = message.item as Record<string, unknown>
    if ((item.kind === 'text' || item.kind === 'link') && typeof item.id === 'string' && typeof item.value === 'string' && typeof item.createdAt === 'number') return message as SharedText
  }
  if (message.type === 'file-offer' && typeof message.transferId === 'string' && typeof message.name === 'string' && typeof message.size === 'number' && typeof message.mimeType === 'string' && typeof message.totalChunks === 'number') return message as FileOffer
  if (['file-accept', 'file-decline', 'file-cancel', 'file-complete'].includes(message.type) && typeof message.transferId === 'string') return message as FileReply | FileComplete
  return null
}

export const CHUNK_SIZE = 64 * 1024
export const totalChunksFor = (size: number) => Math.ceil(size / CHUNK_SIZE)
