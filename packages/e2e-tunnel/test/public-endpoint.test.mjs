import test from 'node:test'
import assert from 'node:assert/strict'
import { generateClientKeypair, publicEndpointSocketUrl } from '../src/client.ts'

test('Client Instance key generation returns independent X25519 material', () => {
  const first = generateClientKeypair()
  const second = generateClientKeypair()
  assert.equal(first.publicKey.length, 32)
  assert.equal(first.secretKey.length, 32)
  assert.notDeepEqual(first.publicKey, second.publicKey)
})

test('Public Endpoint route URLs stay on the advertised HTTPS origin and base path', () => {
  assert.equal(
    publicEndpointSocketUrl('https://host.example/gateway/?ignored=yes#fragment', 'signal', 'a'.repeat(32)),
    'wss://host.example/gateway/signal/' + 'a'.repeat(32),
  )
  assert.equal(
    publicEndpointSocketUrl('https://host.example', 'tunnel', 'b'.repeat(32)),
    'wss://host.example/tunnel/' + 'b'.repeat(32),
  )
})

test('Public Endpoint URL builder rejects non-HTTPS and malformed rooms', () => {
  assert.throws(() => publicEndpointSocketUrl('http://host.example', 'tunnel', 'a'.repeat(32)), /HTTPS/)
  assert.throws(() => publicEndpointSocketUrl('https://host.example', 'signal', '../escape'), /room/)
})
