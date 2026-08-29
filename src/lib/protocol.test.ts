import { describe, expect, it } from 'vitest'
import { parseMessage } from './protocol'

describe('system event protocol messages', () => {
  it('accepts a validated nickname change', () => {
    expect(parseMessage({
      v: 2,
      type: 'system-event',
      id: 'rename_1',
      event: 'nickname-changed',
      previousName: 'Mina',
      nextName: 'M',
      createdAt: 1,
    })).toMatchObject({ type: 'system-event', event: 'nickname-changed' })
  })

  it('rejects incomplete or invalid system events', () => {
    expect(parseMessage({
      v: 2,
      type: 'system-event',
      id: 'setting_1',
      event: 'setting-changed',
      setting: 'free-for-all',
      createdAt: 1,
    })).toBeNull()
  })
})

describe('data saver protocol messages', () => {
  it('accepts a peer-specific data saver capability', () => {
    expect(parseMessage({ v: 2, type: 'data-saver', enabled: true })).toMatchObject({ type: 'data-saver', enabled: true })
  })

  it('rejects an invalid data saver capability', () => {
    expect(parseMessage({ v: 2, type: 'data-saver', enabled: 'yes' })).toBeNull()
  })
})
