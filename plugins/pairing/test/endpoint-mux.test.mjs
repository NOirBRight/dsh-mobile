import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import { createHostGateway } from '../src/gateway.ts'
import { createEndpointMux } from '../src/endpoint-mux.ts'
import { parseMuxCliOptions } from '../src/mux-cli.ts'

test('a shared Public Endpoint mux routes two Hosts and lists both identities', async (t) => {
  const daily = createHostGateway({
    bind: '127.0.0.1', port: 0, hostIdentity: 'daily-host',
    onSignal() {},
    onTunnel(socket) { socket.on('message', data => socket.send('daily:' + data)) },
  })
  const lab = createHostGateway({
    bind: '127.0.0.1', port: 0, hostIdentity: 'lab-host',
    onSignal() {},
    onTunnel(socket) { socket.on('message', data => socket.send('lab:' + data)) },
  })
  const dailyPort = await daily.listen(); t.after(() => daily.close())
  const labPort = await lab.listen(); t.after(() => lab.close())
  const dailyRoom = 'a'.repeat(32)
  const labRoom = 'b'.repeat(32)
  daily.authorizeRoom(dailyRoom)
  lab.authorizeRoom(labRoom)

  const mux = createEndpointMux({ bind: '127.0.0.1', port: 0, backends: [dailyPort, labPort] })
  const port = await mux.listen(); t.after(() => mux.close())
  const health = await (await fetch('http://127.0.0.1:' + port + '/.well-known/dsh-mobile')).json()
  assert.equal(health.protocol, 1)
  assert.deepEqual(health.hostIdentities, ['daily-host', 'lab-host'])
  assert.equal(health.hostIdentity, 'daily-host')

  const dailySocket = new WebSocket('ws://127.0.0.1:' + port + '/tunnel/' + dailyRoom)
  const labSocket = new WebSocket('ws://127.0.0.1:' + port + '/tunnel/' + labRoom)
  await Promise.all([once(dailySocket, 'open'), once(labSocket, 'open')])
  dailySocket.send('web'); labSocket.send('phone')
  assert.equal(String((await once(dailySocket, 'message'))[0]), 'daily:web')
  assert.equal(String((await once(labSocket, 'message'))[0]), 'lab:phone')
  dailySocket.close(); labSocket.close()

  const unknown = new WebSocket('ws://127.0.0.1:' + port + '/tunnel/' + 'c'.repeat(32))
  await assert.rejects(once(unknown, 'open'), /401/)
})

test('a shared Public Endpoint mux keeps two rooms on one Host plus a second Host', async (t) => {
  const daily = createHostGateway({
    bind: '127.0.0.1', port: 0, hostIdentity: 'daily-host',
    onSignal() {},
    onTunnel(socket, room) { socket.on('message', data => socket.send('daily:' + room.slice(0, 1) + ':' + data)) },
  })
  const lab = createHostGateway({
    bind: '127.0.0.1', port: 0, hostIdentity: 'lab-host',
    onSignal() {},
    onTunnel(socket) { socket.on('message', data => socket.send('lab:' + data)) },
  })
  const dailyPort = await daily.listen(); t.after(() => daily.close())
  const labPort = await lab.listen(); t.after(() => lab.close())
  const phoneA = 'a'.repeat(32)
  const phoneB = 'b'.repeat(32)
  const labPhone = 'c'.repeat(32)
  daily.authorizeRoom(phoneA)
  daily.authorizeRoom(phoneB)
  lab.authorizeRoom(labPhone)

  const mux = createEndpointMux({ bind: '127.0.0.1', port: 0, backends: [dailyPort, labPort] })
  const port = await mux.listen(); t.after(() => mux.close())
  const first = new WebSocket('ws://127.0.0.1:' + port + '/tunnel/' + phoneA)
  const second = new WebSocket('ws://127.0.0.1:' + port + '/tunnel/' + phoneB)
  const third = new WebSocket('ws://127.0.0.1:' + port + '/tunnel/' + labPhone)
  await Promise.all([once(first, 'open'), once(second, 'open'), once(third, 'open')])
  first.send('one'); second.send('two'); third.send('three')
  assert.equal(String((await once(first, 'message'))[0]), 'daily:a:one')
  assert.equal(String((await once(second, 'message'))[0]), 'daily:b:two')
  assert.equal(String((await once(third, 'message'))[0]), 'lab:three')
  first.close(); second.close(); third.close()
})

test('a shared Public Endpoint mux upgrades /signal/check and omits a down backend', async (t) => {
  const daily = createHostGateway({
    bind: '127.0.0.1', port: 0, hostIdentity: 'daily-host',
    onSignal() {}, onTunnel() {},
  })
  const lab = createHostGateway({
    bind: '127.0.0.1', port: 0, hostIdentity: 'lab-host',
    onSignal() {}, onTunnel() {},
  })
  const dailyPort = await daily.listen(); t.after(() => daily.close())
  const labPort = await lab.listen()
  const mux = createEndpointMux({ bind: '127.0.0.1', port: 0, backends: [dailyPort, labPort] })
  const port = await mux.listen(); t.after(() => mux.close())

  const check = new WebSocket('ws://127.0.0.1:' + port + '/signal/check')
  await once(check, 'open')
  check.close()

  await lab.close()
  const health = await (await fetch('http://127.0.0.1:' + port + '/.well-known/dsh-mobile')).json()
  assert.deepEqual(health.hostIdentities, ['daily-host'])
  assert.equal(health.hostIdentity, 'daily-host')
})

test('mux CLI requires this Host\'s Gateway ports and does not default to a maintainer topology', () => {
  assert.throws(() => parseMuxCliOptions({}), /DSH_PAIR_MUX_BACKENDS/)
  assert.throws(() => parseMuxCliOptions({ DSH_PAIR_MUX_BIND: '0.0.0.0', DSH_PAIR_MUX_BACKENDS: '4001,4002' }), /loopback/)
  assert.deepEqual(parseMuxCliOptions({ DSH_PAIR_MUX_BACKENDS: '4001,4002' }), { bind: '127.0.0.1', port: 0, backends: [4001, 4002] })
  assert.deepEqual(parseMuxCliOptions({ DSH_PAIR_MUX_BIND: '127.0.0.1', DSH_PAIR_MUX_PORT: '4000', DSH_PAIR_MUX_BACKENDS: '4001,4002' }), {
    bind: '127.0.0.1', port: 4000, backends: [4001, 4002],
  })
})
