import test from 'node:test'
import assert from 'node:assert/strict'
import { connectionRecoveryDecision, endpointRefreshRequired } from '../src/reconnect-recovery.ts'

test('only actionable failures stop automatic reconnect', () => {
  assert.equal(connectionRecoveryDecision('custom', 'retry-wait', 'network unavailable'), null)
  assert.equal(connectionRecoveryDecision('temporary', 'retry-wait', 'handshake: endpoint WebSocket connection failed'), 'endpoint')
  assert.equal(connectionRecoveryDecision('custom', 'retry-wait', 'credential is missing'), 'credential')
  assert.equal(connectionRecoveryDecision('custom', 'terminal', 'bad-token'), 'credential')
})

test('an unreachable temporary endpoint offers Endpoint Refresh recovery', () => {
  assert.equal(endpointRefreshRequired('temporary', 'handshake: endpoint WebSocket connection failed'), true)
  assert.equal(endpointRefreshRequired('temporary', 'direct signaling WebSocket connection failed'), true)
})

test('authorization errors and stable custom endpoints do not claim rotation', () => {
  assert.equal(endpointRefreshRequired('temporary', 'Host authorization revoked'), false)
  assert.equal(endpointRefreshRequired('custom', 'handshake: endpoint WebSocket connection failed'), false)
})
