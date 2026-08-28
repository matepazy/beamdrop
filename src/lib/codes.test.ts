import { describe, expect, it } from 'vitest'
import { deriveRoomMaterial } from './crypto'
import { generateCode, isValidSecret, secretFromJoinInput } from './codes'
import { formatBytes, isUrl } from './format'
import { CHUNK_SIZE, decodeChunk, encodeChunk, parseMessage, totalChunksFor } from './protocol'

describe('Beam capability and protocol boundaries', () => {
  it('generates a readable word-word-number join code', () => { const capability = generateCode(); expect(capability).toMatch(/^[a-z]+-[a-z]+-\d{2}$/); expect(isValidSecret(capability)).toBe(true) })
  it('extracts an opaque capability from a Beam join link', () => { const capability = generateCode(); expect(secretFromJoinInput(`https://beam.example/#/join/${capability}`)).toBe(capability) })
  it('derives separate stable room and signaling values', async () => { const first = await deriveRoomMaterial('QfnzD7V-sLEK8WLHxQ2lAA'); const second = await deriveRoomMaterial('QfnzD7V-sLEK8WLHxQ2lAA'); expect(first.roomId).toBe(second.roomId); expect(first.signalingKey).toBe(second.signalingKey); expect(first.roomId).not.toBe(first.signalingKey) })
  it('rejects malformed codes', () => { expect(isValidSecret('hello\nworld')).toBe(false); expect(isValidSecret('tiny')).toBe(false) })
  it('formats bytes and permits only web URLs', () => { expect(formatBytes(1536)).toBe('1.5 KB'); expect(isUrl('https://beam.example')).toBe(true); expect(isUrl('javascript:alert(1)')).toBe(false) })
  it('strictly validates control messages', () => { expect(parseMessage({ v: 2, type: 'hello', name: 'Phone', deviceType: 'phone' })).not.toBeNull(); expect(parseMessage({ type: 'hello', name: 'Phone', deviceType: 'phone' })).toBeNull(); expect(parseMessage({ v: 2, type: 'item', item: { id: 'x'.repeat(129), kind: 'text', value: 'x', createdAt: 1 } })).toBeNull() })
  it('uses a length-checked binary chunk frame', () => { const body = new Uint8Array([1, 2, 3]); const frame = encodeChunk('transfer_1', 4, body); expect(decodeChunk(frame)).toMatchObject({ transferId: 'transfer_1', index: 4, payload: body }); frame[10] = 0xff; expect(decodeChunk(frame)).toBeNull() })
  it('calculates chunks from the bounded payload size', () => expect(totalChunksFor(CHUNK_SIZE + 1)).toBe(2))
})
