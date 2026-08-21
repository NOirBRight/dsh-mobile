import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import { createHostGateway } from '../src/gateway.ts'

test('loopback Gateway exposes bounded HTTP and signaling/tunnel WebSockets', async (t) => {
  const gateway = createHostGateway({
    bind: '127.0.0.1', port: 0, hostIdentity: 'host-key',
    shellAsset: path => path === '/' ? { body: Buffer.from('<!doctype html>shell'), contentType: 'text/html' } : null,
    isPersistentRoom: room => room === 'b'.repeat(32),
    onSignal: (socket) => socket.on('message', data => socket.send('answer:' + data)),
    onTunnel: (socket) => socket.on('message', (data, binary) => binary && socket.send(data, { binary: true })),
  })
  const port = await gateway.listen(); t.after(() => gateway.close())
  const base = 'http://127.0.0.1:' + port
  const health = await (await fetch(base + '/.well-known/dsh-mobile')).json()
  assert.deepEqual(health, { protocol: 1, hostIdentity: 'host-key', capabilities: { browser: false, direct: true, tunnel: true, endpointRefresh: true } })
  assert.equal((await fetch(base + '/')).status, 404)
  assert.equal((await fetch(base + '/http://127.0.0.1:3080')).status, 404)

  // Public callers may load the shell and capabilities, but only the local
  // Host UI may mint pairing offers or exchange long-lived credentials.
  assert.equal((await fetch(base + '/pair')).status, 404)
  assert.equal((await fetch(base + '/pair/exchange', { method: 'POST' })).status, 404)
  assert.equal((await fetch(base + '/endpoint/refresh', { method: 'POST', headers: { authorization: 'Bearer live-token' } })).status, 404)

  const room = 'a'.repeat(32)
  gateway.authorizeRoom(room)
  const signal = new WebSocket('ws://127.0.0.1:' + port + '/signal/' + room)
  await once(signal, 'open'); signal.send('offer'); assert.equal(String((await once(signal, 'message'))[0]), 'answer:offer')
  const busy = new WebSocket('ws://127.0.0.1:' + port + '/signal/' + room)
  await assert.rejects(once(busy, 'open'), /409/)
  const tunnelWhileSignal = new WebSocket('ws://127.0.0.1:' + port + '/tunnel/' + room)
  await once(tunnelWhileSignal, 'open')
  const busyTunnel = new WebSocket('ws://127.0.0.1:' + port + '/tunnel/' + room)
  await assert.rejects(once(busyTunnel, 'open'), /409/)
  tunnelWhileSignal.close(); await once(tunnelWhileSignal, 'close')
  signal.close(); await once(signal, 'close')
  const tunnel = new WebSocket('ws://127.0.0.1:' + port + '/tunnel/' + room)
  await once(tunnel, 'open'); tunnel.send(Buffer.from([1, 2, 3])); assert.deepEqual(Buffer.from((await once(tunnel, 'message'))[0]), Buffer.from([1, 2, 3])); tunnel.close(); await once(tunnel, 'close')
  const persistent = new WebSocket('ws://127.0.0.1:' + port + '/tunnel/' + 'b'.repeat(32))
  await once(persistent, 'open'); persistent.close()
  const unknown = new WebSocket('ws://127.0.0.1:' + port + '/tunnel/not-a-room')
  await assert.rejects(once(unknown, 'open'), /401/)
})

test('Gateway does not serve Host plugin bundles or generic DSH paths', async (t) => {
  const gateway = createHostGateway({
    bind: '127.0.0.1', port: 0, hostIdentity: 'host-key',
    shellAsset: () => null,
    onSignal() {}, onTunnel() {},
  })
  const gwPort = await gateway.listen(); t.after(() => gateway.close())
  const base = 'http://127.0.0.1:' + gwPort
  assert.equal((await fetch(base + '/plugins/demo/client.js?rev=1')).status, 404)
  assert.equal((await fetch(base + '/api/host.describe')).status, 404)
  assert.equal((await fetch(base + '/plugins/../package.json')).status, 404)
  assert.equal((await fetch(base + '/plugins/%252e%252e/api/host.describe')).status, 404)
  assert.equal((await fetch(base + '/pair/status')).status, 404)
})

test('Gateway refuses non-loopback binds', () => {
  assert.throws(() => createHostGateway({ bind: '0.0.0.0', port: 0, hostIdentity: 'x', shellAsset: () => null, onSignal() {}, onTunnel() {} }), /loopback/)
})
