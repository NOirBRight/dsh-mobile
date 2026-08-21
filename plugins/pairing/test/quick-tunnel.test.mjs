import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { QuickTunnelController, CLOUDFLARED_QUICK_PROVIDER } from '../src/quick-tunnel.ts'

class FakeChild extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  killed = false
  kill() { this.killed = true; this.emit('exit', 0, null); return true }
}

test('quick tunnel starts cloudflared, reports ready/rotation, and cleans up', async () => {
  const child = new FakeChild(); const calls = []; const states = []
  const controller = new QuickTunnelController({
    spawn: (command, args) => { calls.push([command, args]); return child },
    onStatus: state => states.push(state),
  })
  controller.start('http://127.0.0.1:43123')
  assert.deepEqual(calls, [['cloudflared', ['tunnel', '--url', 'http://127.0.0.1:43123', '--no-autoupdate']]])
  child.stderr.write('Your quick Tunnel has been created! Visit https://first.trycloudflare.com now\n')
  child.stdout.write('new route https://second.trycloudflare.com\n')
  assert.deepEqual(states.map(x => x.state), ['starting', 'ready', 'rotated'])
  assert.equal(controller.endpoint(), 'https://second.trycloudflare.com')
  await controller.stop()
  assert.equal(child.killed, true)
  assert.equal(states.at(-1).state, 'stopped')
})

test('quick tunnel reports an unexpected clean process exit as stopped', () => {
  const child = new FakeChild(); const states = []
  const controller = new QuickTunnelController({ spawn: () => child, onStatus: state => states.push(state) })
  controller.start('http://127.0.0.1:1')
  child.emit('exit', 0, null)
  assert.equal(states.at(-1).state, 'stopped')
})

test('quick tunnel reports process errors without inventing an endpoint', () => {
  const child = new FakeChild(); const states = []
  const controller = new QuickTunnelController({ spawn: () => child, onStatus: state => states.push(state) })
  controller.start('http://127.0.0.1:1')
  child.emit('error', new Error('cloudflared missing'))
  assert.equal(controller.endpoint(), null)
  assert.deepEqual(states.at(-1), { state: 'error', error: 'cloudflared missing' })
})

test('stop ignores leftover cloudflared logs so a later Custom Endpoint is not overwritten', async () => {
  const child = new FakeChild(); const states = []
  const controller = new QuickTunnelController({ spawn: () => child, onStatus: state => states.push(state) })
  controller.start('http://127.0.0.1:43169')
  child.stderr.write('Visit https://old.trycloudflare.com now\n')
  await controller.stop()
  child.stderr.write('Visit https://old.trycloudflare.com now\n')
  assert.equal(states.filter(s => s.state === 'ready' || s.state === 'rotated').length, 1)
  assert.equal(states.at(-1).state, 'stopped')
  assert.equal(controller.endpoint(), null)
})

test('detach leaves cloudflared running so a plugin reload can reuse the hostname', async () => {
  const child = new FakeChild(); const states = []
  const controller = new QuickTunnelController({ spawn: () => child, onStatus: state => states.push(state) })
  controller.start('http://127.0.0.1:43169')
  child.stderr.write('Visit https://keep.trycloudflare.com now\n')
  controller.detach()
  assert.equal(child.killed, false)
  assert.equal(controller.alive(), true)
  assert.equal(controller.localGateway(), 'http://127.0.0.1:43169')
  assert.equal(controller.endpoint(), 'https://keep.trycloudflare.com')
  assert.equal(states.at(-1).state, 'ready')
})

test('unexpected cloudflared exit respawns against the same local Gateway', () => {
  const first = new FakeChild(); const second = new FakeChild(); const children = [first, second]; const states = []
  const controller = new QuickTunnelController({
    spawn: () => children.shift(),
    onStatus: state => states.push(state),
    restartOnUnexpectedExit: true,
  })
  controller.start('http://127.0.0.1:43169')
  first.stderr.write('Visit https://old.trycloudflare.com now\n')
  first.emit('exit', 1, null)
  second.stderr.write('Visit https://new.trycloudflare.com now\n')
  assert.equal(first.killed, false)
  assert.equal(controller.endpoint(), 'https://new.trycloudflare.com')
  assert.deepEqual(states.map(x => x.state), ['starting', 'ready', 'starting', 'rotated'])
})

test('quick tunnel can spawn a configured non-cloudflared provider', () => {
  const child = new FakeChild(); const calls = []; const states = []
  const controller = new QuickTunnelController({
    spawn: (command, args) => { calls.push([command, args]); return child },
    onStatus: state => states.push(state),
    provider: {
      command: 'frpc',
      args: local => ['http', local],
      endpointPattern: /https:\/\/[a-z0-9.-]+\.example\.test\b/ig,
    },
  })
  controller.start('http://127.0.0.1:43123')
  assert.deepEqual(calls, [['frpc', ['http', 'http://127.0.0.1:43123']]])
  child.stderr.write('endpoint ready at https://pair.example.test\n')
  assert.deepEqual(states.at(-1), { state: 'ready', endpoint: 'https://pair.example.test' })
})

test('reattach delivers later rotations to the new apply callback', () => {
  const child = new FakeChild(); const first = []; const second = []
  const controller = new QuickTunnelController({ spawn: () => child, onStatus: state => first.push(state) })
  controller.start('http://127.0.0.1:43169')
  child.stderr.write('Visit https://keep.trycloudflare.com now\n')
  controller.detach()
  controller.reattach(state => second.push(state))
  child.stderr.write('Visit https://next.trycloudflare.com now\n')
  assert.equal(first.at(-1).state, 'ready')
  assert.deepEqual(second.map(s => s.state), ['rotated'])
  assert.equal(controller.endpoint(), 'https://next.trycloudflare.com')
})

test('quick tunnel ignores captured URLs that are not credential-free HTTPS', () => {
  const child = new FakeChild(); const states = []
  const controller = new QuickTunnelController({
    spawn: () => child,
    onStatus: state => states.push(state),
    provider: { command: 'x', args: () => [], endpointPattern: /https?:\/\/\S+/ig },
  })
  controller.start('http://127.0.0.1:1')
  child.stderr.write('http://insecure.example now\n')
  child.stderr.write('https://user:secret@leaky.example now\n')
  assert.equal(controller.endpoint(), null)
  assert.equal(states.filter(s => s.state === 'ready').length, 0)
})
