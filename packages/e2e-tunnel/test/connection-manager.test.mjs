import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ConnectionCoordinator, TunnelError } from '../src/index.ts'

function fakeClient() {
  return { state: 'open', deviceToken: 'token', fetch: async () => new Response(), openWebSocket: () => ({}), probe: async () => {}, close() {} }
}

test('Automatic exposes direct attempt then visible Tunnel Fallback', async () => {
  const states = []
  let tunnelCalls = 0
  const coordinator = new ConnectionCoordinator({
    policy: 'automatic', capabilities: { direct: true, tunnel: true },
    connectDirect: async () => { throw new TunnelError('ice-failed') },
    connectTunnel: async () => { tunnelCalls += 1; return fakeClient() },
    onState: (state) => states.push(state),
  })
  const client = await coordinator.connect()
  assert.equal(client.deviceToken, 'token')
  assert.equal(coordinator.activeRoute, 'tunnel')
  assert.equal(tunnelCalls, 1)
  assert.deepEqual(states.map((state) => state.phase), ['direct-connecting', 'tunnel-connecting', 'tunnel-open'])
  assert.equal(states.at(-1).route, 'tunnel')
})

test('Direct Only never invokes Tunnel Fallback', async () => {
  let tunnelCalls = 0
  const coordinator = new ConnectionCoordinator({
    policy: 'direct-only', capabilities: { direct: true, tunnel: true },
    connectDirect: async () => { throw new TunnelError('ice-failed') },
    connectTunnel: async () => { tunnelCalls += 1; return fakeClient() },
  })
  await assert.rejects(coordinator.connect(), (error) => error.code === 'ice-failed')
  assert.equal(tunnelCalls, 0)
  assert.equal(coordinator.activeRoute, null)
})

test('Automatic does not hide a pairing-limit Host verdict behind Tunnel Fallback', async () => {
  let tunnelCalls = 0
  const coordinator = new ConnectionCoordinator({
    policy: 'automatic', capabilities: { direct: true, tunnel: true },
    connectDirect: async () => { throw new TunnelError('limit') },
    connectTunnel: async () => { tunnelCalls += 1; return fakeClient() },
  })
  await assert.rejects(coordinator.connect(), (error) => error.code === 'limit')
  assert.equal(tunnelCalls, 0)
})

test('Automatic does not hide authentication failure behind Tunnel Fallback', async () => {
  let tunnelCalls = 0
  const coordinator = new ConnectionCoordinator({
    policy: 'automatic', capabilities: { direct: true, tunnel: true },
    connectDirect: async () => { throw new TunnelError('bad-token') },
    connectTunnel: async () => { tunnelCalls += 1; return fakeClient() },
  })
  await assert.rejects(coordinator.connect(), (error) => error.code === 'bad-token')
  assert.equal(tunnelCalls, 0)
})

test('Tunnel Only skips direct and foreground probe uses the active client', async () => {
  let directCalls = 0
  let probes = 0
  const client = { ...fakeClient(), probe: async () => { probes += 1 } }
  const coordinator = new ConnectionCoordinator({
    policy: 'tunnel-only', capabilities: { direct: true, tunnel: true },
    connectDirect: async () => { directCalls += 1; return fakeClient() },
    connectTunnel: async () => client,
  })
  await coordinator.connect()
  await coordinator.probe()
  assert.equal(directCalls, 0)
  assert.equal(probes, 1)
})
