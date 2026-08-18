import test from 'node:test'
import assert from 'node:assert/strict'
import { endpointRefreshRequired } from '../src/reconnect-recovery.ts'

test('an unreachable temporary endpoint offers Endpoint Refresh recovery', () => {
  assert.equal(endpointRefreshRequired('temporary', 'handshake: endpoint WebSocket connection failed'), true)
  assert.equal(endpointRefreshRequired('temporary', 'direct signaling WebSocket connection failed'), true)
})

test('authorization errors and stable custom endpoints do not claim rotation', () => {
  assert.equal(endpointRefreshRequired('temporary', 'Host authorization revoked'), false)
  assert.equal(endpointRefreshRequired('custom', 'handshake: endpoint WebSocket connection failed'), false)
})
