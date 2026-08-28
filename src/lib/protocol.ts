export const PROTOCOL_VERSION = 2
export const MAX_CONTROL_BYTES = 16 * 1024
export const MAX_CHUNK_BYTES = 64 * 1024
export const MAX_FILE_SIZE = 1024 * 1024 * 1024 * 1024
export const MAX_ACTIVE_TRANSFERS = 4
export const CHUNK_SIZE = 48 * 1024
export const totalChunksFor = (size: number) => Math.ceil(size / CHUNK_SIZE)
type DeviceType = 'phone' | 'tablet' | 'computer'
export type PeerHello = { v: 2; type: 'hello'; name: string; deviceType: DeviceType }
export type SharedText = { v: 2; type: 'item'; item: { id: string; kind: 'text' | 'link'; value: string; createdAt: number } }
export type FileOffer = { v: 2; type: 'file-offer'; transferId: string; name: string; size: number; mimeType: string; totalChunks: number }
export type FileReply = { v: 2; type: 'file-accept' | 'file-decline' | 'file-cancel' | 'file-complete'; transferId: string }
export type KickNotice = { v: 2; type: 'kick-notice' }
export type BeamMessage = PeerHello | SharedText | FileOffer | FileReply | KickNotice
const string = (value: unknown, max: number) => typeof value === 'string' && value.length <= max && !/[\u0000-\u001f]/.test(value)
const id = (value: unknown) => typeof value === 'string' && string(value, 128) && /^[A-Za-z0-9_-]+$/.test(value)
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value)
export function isSafeHttpUrl(value: unknown) { if (typeof value !== 'string') return false; try { const url = new URL(value); return url.protocol === 'https:' || url.protocol === 'http:' } catch { return false } }
export function parseMessage(input: unknown): BeamMessage | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const message = input as Record<string, unknown>
  if (JSON.stringify(message).length > MAX_CONTROL_BYTES || message.v !== PROTOCOL_VERSION || typeof message.type !== 'string') return null
  if (message.type === 'hello' && string(message.name, 48) && ['phone', 'tablet', 'computer'].includes(String(message.deviceType))) return message as PeerHello
  if (message.type === 'kick-notice') return message as KickNotice
  if (message.type === 'item' && message.item && typeof message.item === 'object') { const item = message.item as Record<string, unknown>; if (id(item.id) && (item.kind === 'text' || item.kind === 'link') && string(item.value, 8_000) && finite(item.createdAt) && (item.createdAt as number) > 0 && (item.kind !== 'link' || isSafeHttpUrl(item.value))) return message as SharedText }
  if (message.type === 'file-offer' && id(message.transferId) && string(message.name, 255) && string(message.mimeType, 127) && finite(message.size) && (message.size as number) >= 0 && (message.size as number) <= MAX_FILE_SIZE && Number.isSafeInteger(message.totalChunks) && message.totalChunks === totalChunksFor(message.size as number)) return message as FileOffer
  if (['file-accept', 'file-decline', 'file-cancel', 'file-complete'].includes(message.type) && id(message.transferId)) return message as FileReply
  return null
}
const MAGIC = [0x42, 0x44, 2, 1]
export function encodeChunk(transferId: string, index: number, payload: Uint8Array) { const transfer = new TextEncoder().encode(transferId); if (!id(transferId) || !Number.isSafeInteger(index) || index < 0 || payload.byteLength > MAX_CHUNK_BYTES) throw new Error('invalid chunk'); const out = new Uint8Array(16 + transfer.length + payload.length); out.set(MAGIC); const view = new DataView(out.buffer); view.setUint16(4, transfer.length); view.setUint32(6, index); view.setUint32(10, payload.length); out.set(transfer, 16); out.set(payload, 16 + transfer.length); return out }
export function decodeChunk(data: unknown): { transferId: string; index: number; payload: Uint8Array } | null { const bytes = data instanceof Uint8Array ? data : data instanceof ArrayBuffer ? new Uint8Array(data) : null; if (!bytes || bytes.byteLength < 16 || bytes.byteLength > MAX_CHUNK_BYTES + 144 || !MAGIC.every((value, index) => bytes[index] === value)) return null; const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); const idLength = view.getUint16(4); const index = view.getUint32(6); const payloadLength = view.getUint32(10); if (idLength > 128 || payloadLength > MAX_CHUNK_BYTES || 16 + idLength + payloadLength !== bytes.byteLength) return null; const transferId = new TextDecoder().decode(bytes.subarray(16, 16 + idLength)); return id(transferId) ? { transferId, index, payload: bytes.subarray(16 + idLength) } : null }
