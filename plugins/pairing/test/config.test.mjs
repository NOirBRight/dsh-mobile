// Config schema + resolve step: defaults, derivation, and fail-loud rejection.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Config, resolveConfig } from '../src/config.ts'

test('schema fills defaults', () => {
  const c = Config({})
  assert.equal(c.bind, '0.0.0.0')
  assert.equal(c.port, 0)
  assert.equal(c.dshHost, '127.0.0.1')
  assert.equal(c.dshPort, 3080)
  assert.equal(c.codeTtlMs, 300_000)
  assert.deepEqual(c.quickTunnelArgs, ['tunnel', '--url', '{gateway}', '--no-autoupdate'])
  assert.equal(c.advertiseUrl, undefined)
})


test('defaults to a loopback Gateway with a Quick Public Endpoint', () => {
  const c = Config({})
  assert.equal(c.appUrl, 'dsh-mobile://pair')
  assert.equal(c.endpointMode, 'quick')
  assert.equal(c.customEndpointUrl, undefined)
  assert.equal(c.gatewayBind, '127.0.0.1')
  assert.equal(c.gatewayPort, 0)
  assert.equal(c.signalingUrl, undefined)
  assert.equal(c.enableDirect, true)
  assert.deepEqual(c.stunUrls, ['stun:stun.cloudflare.com:3478'])
})

test('schema rejects out-of-range values at load', () => {
  assert.throws(() => Config({ port: 70000 }))
  assert.throws(() => Config({ dshPort: -1 }))
  assert.throws(() => Config({ codeTtlMs: '5min' }))
})

test('resolveConfig derives store paths from dshHome', () => {
  const r = resolveConfig(Config({ dshHome: '/tmp/x-dsh-home' }))
  assert.equal(r.keyStorePath, '/tmp/x-dsh-home/mobile/daemon-keypair.json')
  assert.equal(r.tokenStorePath, '/tmp/x-dsh-home/mobile/devices.json')
})

test('resolveConfig keeps explicit store paths', () => {
  const r = resolveConfig(Config({ dshHome: '/x', keyStorePath: '/k.json', tokenStorePath: '/t.json' }))
  assert.equal(r.keyStorePath, '/k.json')
  assert.equal(r.tokenStorePath, '/t.json')
})

test('resolveConfig rejects malformed URLs (fail loud)', () => {
  assert.throws(() => resolveConfig(Config({ advertiseUrl: 'not-a-url' })), /advertiseUrl/)
  assert.throws(() => resolveConfig(Config({ appUrl: 'ftp://x' })), /appUrl/)
  assert.throws(() => resolveConfig(Config({ endpointMode: 'custom' })), /customEndpointUrl/)
  assert.throws(() => resolveConfig(Config({ endpointMode: 'custom', customEndpointUrl: 'http://x' })), /HTTPS/)
  assert.throws(() => resolveConfig(Config({ signalingUrl: 'https://x' })), /signalingUrl/)
  assert.throws(() => resolveConfig(Config({ stunUrls: ['turn:relay.example.com'] })), /STUN-only/)
  assert.throws(() => resolveConfig(Config({ codeTtlMs: 0 })), /codeTtlMs/)
  assert.throws(() => resolveConfig(Config({ dshHost: '8.8.8.8' })), /dshHost must be loopback/)
})

test('resolveConfig rejects an invalid Quick Tunnel endpoint pattern', () => {
  assert.throws(() => resolveConfig(Config({ quickTunnelEndpointPattern: '(' })), /quickTunnelEndpointPattern/)
})

test('resolveConfig accepts ws(s) advertiseUrl for relay mode', () => {
  const r = resolveConfig(Config({ advertiseUrl: 'wss://relay.example.com' }))
  assert.equal(r.advertiseUrl, 'wss://relay.example.com')
})
