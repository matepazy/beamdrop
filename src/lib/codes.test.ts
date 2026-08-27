import { describe, expect, it } from 'vitest'
import { generateCode, isValidSecret, normalizeSecret } from './codes'
import { formatBytes, isUrl } from './format'
import { parseMessage, totalChunksFor } from './protocol'

describe('Beam utility functions', () => {
  it('normalizes formatted short codes', () => expect(normalizeSecret(' h7km p4xt ')).toBe('H7KM-P4XT'))
  it('makes valid code format', () => expect(generateCode()).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/))
  it('rejects unsafe secrets', () => { expect(isValidSecret('ok')).toBe(false); expect(isValidSecret('hello\nworld')).toBe(false) })
  it('formats bytes and detects URLs', () => { expect(formatBytes(1536)).toBe('1.5 KB'); expect(isUrl('https://beam.example')).toBe(true); expect(isUrl('nope')).toBe(false) })
  it('validates control message shape', () => { expect(parseMessage({ type: 'hello', name: 'Phone', deviceType: 'phone' })).not.toBeNull(); expect(parseMessage({ type: 'member-introduction', token: 'approval-token' })).not.toBeNull(); expect(parseMessage({ type: 'hello', name: 5 })).toBeNull() })
  it('calculates chunks', () => expect(totalChunksFor(65 * 1024)).toBe(2))
})
