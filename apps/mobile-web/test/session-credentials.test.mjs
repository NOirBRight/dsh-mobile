import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeSessionCredential, encodeSessionCredential } from '../src/session-credentials.ts'

const keypair = { publicKey: new Uint8Array(32).fill(1), secretKey: new Uint8Array(32).fill(2) }

test('session credential round-trips the stable Client Instance key and optional device token', () => {
  const bytes = encodeSessionCredential({ clientKeypair: keypair, deviceToken: 'device-token' })
  const decoded = decodeSessionCredential(bytes)
  assert.deepEqual(decoded.clientKeypair.publicKey, keypair.publicKey)
  assert.deepEqual(decoded.clientKeypair.secretKey, keypair.secretKey)
  assert.equal(decoded.deviceToken, 'device-token')
})

test('session credential accepts the current 192-bit v4 pairing code', () => {
  const pairingCode = 'q'.repeat(32)
  const decoded = decodeSessionCredential(encodeSessionCredential({ clientKeypair: keypair, pairingCode }))
  assert.equal(decoded.pairingCode, pairingCode)
})

test('session credential decoder rejects malformed versions, keys, and tokens', () => {
  const bytes = value => new TextEncoder().encode(JSON.stringify(value))
  assert.throws(() => decodeSessionCredential(bytes({ v: 2 })), /credential/)
  assert.throws(() => decodeSessionCredential(bytes({ v: 1, publicKey: 'AA', secretKey: 'AA' })), /credential/)
  assert.throws(() => decodeSessionCredential(bytes({ v: 1, publicKey: 'AQ'.repeat(22), secretKey: 'Ag'.repeat(22), deviceToken: '' })), /credential/)
})
