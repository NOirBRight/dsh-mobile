import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ConnectionCoordinator, TunnelError } from '../src/index.ts'

function fakeClient() {
  return { state: 'open', deviceToken: 'token', fetch: async () => new Response(), openWebSocket: () => ({}), probe: async () => {}, close() {}, discard() {} }
}

function emittingClient(onState, token = 'token') {
  const client = {
    state: 'open',
    deviceToken: token,
    fetch: async () => new Response(),
    openWebSocket: () => ({}),
    probe: async () => {},
    close() { client.state = 'closed'; onState?.('closed') },
    discard() { client.state = 'closed' },
  }
  return client
}

test('Automatic uses Tunnel without waiting for Direct to fail', async () => {
  const states = []
  let tunnelCalls = 0
  let directSettled = false
  const coordinator = new ConnectionCoordinator({
    policy: 'automatic', capabilities: { direct: true, tunnel: true },
    connectDirect: async () => { await new Promise(() => {}) },
    connectTunnel: async () => { tunnelCalls += 1; return fakeClient() },
    onState: (state) => states.push(state),
  })
  const client = await coordinator.connect()
  assert.equal(client.deviceToken, 'token')
  assert.equal(coordinator.activeRoute, 'tunnel')
  assert.equal(tunnelCalls, 1)
  assert.equal(directSettled, false)
  assert.equal(states[0].phase, 'tunnel-connecting')
  assert.equal(states.at(-1).phase, 'tunnel-open')
  assert.equal(states.at(-1).route, 'tunnel')
})

test('Automatic can still take Direct when it finishes first', async () => {
  const coordinator = new ConnectionCoordinator({
    policy: 'automatic', capabilities: { direct: true, tunnel: true },
    connectDirect: async () => fakeClient(),
    connectTunnel: async () => { await new Promise(() => {}) },
  })
  await coordinator.connect()
  assert.equal(coordinator.activeRoute, 'direct')
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

test('Automatic does not hide a pairing-limit Host verdict behind Direct', async () => {
  const coordinator = new ConnectionCoordinator({
    policy: 'automatic', capabilities: { direct: true, tunnel: true },
    connectDirect: async () => fakeClient(),
    connectTunnel: async () => { throw new TunnelError('limit') },
  })
  await assert.rejects(coordinator.connect(), (error) => error.code === 'limit')
  assert.equal(coordinator.activeRoute, null)
})

test('Automatic does not hide authentication failure behind Direct', async () => {
  const coordinator = new ConnectionCoordinator({
    policy: 'automatic', capabilities: { direct: true, tunnel: true },
    connectDirect: async () => fakeClient(),
    connectTunnel: async () => { throw new TunnelError('bad-token') },
  })
  await assert.rejects(coordinator.connect(), (error) => error.code === 'bad-token')
  assert.equal(coordinator.activeRoute, null)
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

test('Automatic ignores Direct that finishes after the grace window', async () => {
  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))
  const coordinator = new ConnectionCoordinator({
    policy: 'automatic', capabilities: { direct: true, tunnel: true },
    directGraceMs: 20,
    connectDirect: async () => { await wait(50); return { ...fakeClient(), deviceToken: 'direct' } },
    connectTunnel: async () => { await wait(80); return { ...fakeClient(), deviceToken: 'tunnel' } },
  })
  const client = await coordinator.connect()
  assert.equal(client.deviceToken, 'tunnel')
  assert.equal(coordinator.activeRoute, 'tunnel')
})

test('Automatic loser close does not emit closed for the winning session', async () => {
  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))
  const states = []
  const coordinator = new ConnectionCoordinator({
    policy: 'automatic', capabilities: { direct: true, tunnel: true },
    directGraceMs: 20,
    connectTunnel: async () => emittingClient(state => states.push(state), 'tunnel'),
    connectDirect: async () => { await wait(50); return emittingClient(state => states.push(state), 'direct') },
  })
  const client = await coordinator.connect()
  await wait(80)
  assert.equal(client.deviceToken, 'tunnel')
  assert.equal(coordinator.activeRoute, 'tunnel')
  assert.equal(coordinator.activeClient?.state, 'open')
  assert.equal(states.includes('closed'), false)
})
