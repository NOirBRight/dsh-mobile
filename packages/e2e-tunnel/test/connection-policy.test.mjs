import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connectionAttempts, TunnelError } from '../src/index.ts'

test('Automatic tries Tunnel first and may still attempt Direct', () => {
  assert.deepEqual(connectionAttempts('automatic', { direct: true, tunnel: true }), ['tunnel', 'direct'])
  assert.deepEqual(connectionAttempts('automatic', { direct: false, tunnel: true }), ['tunnel'])
  assert.deepEqual(connectionAttempts('automatic', { direct: true, tunnel: false }), ['direct'])
})

test('Direct Only and Tunnel Only never use the other route', () => {
  assert.deepEqual(connectionAttempts('direct-only', { direct: true, tunnel: true }), ['direct'])
  assert.deepEqual(connectionAttempts('tunnel-only', { direct: true, tunnel: true }), ['tunnel'])
})

test('a policy with no available route fails explicitly', () => {
  assert.throws(() => connectionAttempts('automatic', { direct: false, tunnel: false }),
    (error) => error instanceof TunnelError && error.code === 'no-route')
  assert.throws(() => connectionAttempts('direct-only', { direct: false, tunnel: true }),
    (error) => error instanceof TunnelError && error.code === 'no-route')
})
