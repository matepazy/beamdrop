import { describe, expect, it } from 'vitest'
import { deriveRoomMaterial } from './crypto'
import { createPeerAuthProof, verifyPeerAuthProof } from './peerAuth'
import { BEAM_PROTOCOL_VERSION, isCompatibleProtocol } from './protocolVersion'
import { canonicalReleaseManifest, decodeBase64Url, evaluateRelease, verifyReleaseEnvelope } from './releaseVerification'
import { generateCode, isValidSecret, secretFromJoinInput } from './codes'
import { formatBytes, isUrl } from './format'
import { CHUNK_SIZE, decodeChunk, encodeChunk, parseMessage, totalChunksFor } from './protocol'
import { areAllRecipientsTerminal, isRecipientTerminal, type OutgoingTransfer, type RecipientTransferState } from './transfer'

describe('Beam capability and protocol boundaries', () => {
  it('generates a readable word-word-number join code', () => { const capability = generateCode(); expect(capability).toMatch(/^[a-z]+-[a-z]+-\d{2}$/); expect(isValidSecret(capability)).toBe(true) })
  it('extracts an opaque capability from a Beam join link', () => { const capability = generateCode(); expect(secretFromJoinInput(`https://beam.example/#/join/${capability}`)).toBe(capability) })
  it('derives separate stable room and signaling values', async () => { const first = await deriveRoomMaterial('QfnzD7V-sLEK8WLHxQ2lAA'); const second = await deriveRoomMaterial('QfnzD7V-sLEK8WLHxQ2lAA'); expect(first.roomId).toBe(second.roomId); expect(first.signalingKey).toBe(second.signalingKey); expect(first.roomId).not.toBe(first.signalingKey) })
  it('derives purpose-separated encryption and peer-authentication keys', async () => { const material = await deriveRoomMaterial('QfnzD7V-sLEK8WLHxQ2lAA'); expect(material.appKey.algorithm.name).toBe('AES-GCM'); expect(material.authenticationKey.algorithm.name).toBe('HMAC'); expect(material.appKey.usages).not.toContain('sign'); expect(material.authenticationKey.usages).toContain('verify') })
  it('authenticates nonce-bound peer proofs and rejects replays or altered context', async () => { const material = await deriveRoomMaterial('QfnzD7V-sLEK8WLHxQ2lAA'); const input = { roomId: material.roomId, challengeRole: 'initiator-challenge' as const, challengeNonce: 'q'.repeat(43) }; const proof = await createPeerAuthProof(material.authenticationKey, input); expect(await verifyPeerAuthProof(material.authenticationKey, input, proof)).toBe(true); expect(await verifyPeerAuthProof(material.authenticationKey, { ...input, challengeNonce: 'r'.repeat(43) }, proof)).toBe(false); expect(await verifyPeerAuthProof(material.authenticationKey, { ...input, protocol: BEAM_PROTOCOL_VERSION + 1 }, proof)).toBe(false); const other = await deriveRoomMaterial('different-secret'); expect(await verifyPeerAuthProof(other.authenticationKey, input, proof)).toBe(false); expect(await verifyPeerAuthProof(material.authenticationKey, input, '%%%')).toBe(false) })
  it('negotiates only the explicit peer protocol version', () => { expect(isCompatibleProtocol(BEAM_PROTOCOL_VERSION)).toBe(true); expect(isCompatibleProtocol(BEAM_PROTOCOL_VERSION + 1)).toBe(false) })
  it('verifies signed release metadata and rejects modifications', async () => { const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']); const manifest = { product: 'beamdrop' as const, version: '0.2.0', protocol: BEAM_PROTOCOL_VERSION, commit: 'abcdef123456', builtAt: '2026-08-29T00:00:00Z' }; const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(canonicalReleaseManifest(manifest)))); const encoded = btoa(String.fromCharCode(...signature)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); const publicKey = await crypto.subtle.exportKey('jwk', pair.publicKey); expect(await verifyReleaseEnvelope({ manifest, signature: encoded }, publicKey)).toBe(true); expect(await verifyReleaseEnvelope({ manifest: { ...manifest, version: '0.2.1' }, signature: encoded }, publicKey)).toBe(false); expect(await verifyReleaseEnvelope({ manifest, signature: encoded.slice(1) }, publicKey)).toBe(false); expect(await evaluateRelease(null)).toMatchObject({ officialRelease: false, releaseSignatureValid: false, verifiedReleaseManifest: null }); expect(decodeBase64Url('%%%')).toBeNull() })
  it('rejects malformed codes', () => { expect(isValidSecret('hello\nworld')).toBe(false); expect(isValidSecret('tiny')).toBe(false) })
  it('formats bytes and permits only web URLs', () => { expect(formatBytes(1536)).toBe('1.5 KB'); expect(isUrl('https://beam.example')).toBe(true); expect(isUrl('javascript:alert(1)')).toBe(false) })
  it('strictly validates control messages', () => { expect(parseMessage({ v: 2, type: 'hello', name: 'Phone', deviceType: 'phone' })).not.toBeNull(); expect(parseMessage({ type: 'hello', name: 'Phone', deviceType: 'phone' })).toBeNull(); expect(parseMessage({ v: 2, type: 'item', item: { id: 'x'.repeat(129), kind: 'text', value: 'x', createdAt: 1 } })).toBeNull() })
  it('rejects malformed hostile file metadata', () => { expect(parseMessage({ v: 2, type: 'file-offer', transferId: 'x', name: '../escape', size: 1, mimeType: 'text/plain', totalChunks: 1 })).toBeNull(); expect(parseMessage({ v: 2, type: 'file-offer', transferId: 'x', name: 'a.txt', size: -1, mimeType: 'text/plain', totalChunks: 0 })).toBeNull(); expect(parseMessage({ v: 2, type: 'file-offer', transferId: 'x'.repeat(129), name: 'a.txt', size: 1, mimeType: 'text/plain', totalChunks: 1 })).toBeNull(); expect(parseMessage(null)).toBeNull(); expect(parseMessage({ v: 2, type: 'unknown' })).toBeNull() })
  it('uses a length-checked binary chunk frame', () => { const body = new Uint8Array([1, 2, 3]); const frame = encodeChunk('transfer_1', 4, body); expect(decodeChunk(frame)).toMatchObject({ transferId: 'transfer_1', index: 4, payload: body }); frame[10] = 0xff; expect(decodeChunk(frame)).toBeNull() })
  it('calculates chunks from the bounded payload size', () => expect(totalChunksFor(CHUNK_SIZE + 1)).toBe(2))
  it('does not release an outgoing file until every recipient is terminal', () => {
    const transfer = {
      id: 'transfer_1',
      file: {} as File,
      recipients: new Map<string, RecipientTransferState>([
        ['alice', { peerId: 'alice', status: 'completed', bytesSent: 12 }],
        ['bob', { peerId: 'bob', status: 'transferring', bytesSent: 4 }],
      ]),
    } satisfies OutgoingTransfer
    expect(areAllRecipientsTerminal(transfer)).toBe(false)
    transfer.recipients.get('bob')!.status = 'cancelled'
    expect(isRecipientTerminal('cancelled')).toBe(true)
    expect(areAllRecipientsTerminal(transfer)).toBe(true)
  })
})
