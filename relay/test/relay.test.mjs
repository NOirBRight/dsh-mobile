// Signaling-room behavior test: the VPS forwards only bounded signaling envelopes.
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import assert from 'node:assert/strict'
import WebSocket from 'ws'

const PORT = 18787
const proc = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'pipe' })
await new Promise((resolve) => proc.stdout.once('data', resolve))

const room = 'a'.repeat(32)
const url = (r, role) => 'ws://127.0.0.1:' + PORT + '/r/' + r + '?role=' + role
const open = (u) => { const ws = new WebSocket(u); return once(ws, 'open').then(() => ws) }
const payload = (kind, type, sdp) => Buffer.from(JSON.stringify({ kind, description: { type, sdp } })).toString('base64url')
const signal = (kind, type, sdp, phase = 'sdp') => JSON.stringify({ type: 'signal', phase, payload: payload(kind, type, sdp) })

try {
  const health = await fetch('http://127.0.0.1:' + PORT + '/healthz')
  assert.equal(health.status, 200)
  assert.equal(await health.text(), 'ok')
  assert.equal((await fetch('http://127.0.0.1:' + PORT + '/nope')).status, 404)

  const host = await open(url(room, 'host'))
  const client = await open(url(room, 'client'))
  const hostGot = once(host, 'message')
  client.send(signal('offer', 'offer', 'v=0\r\na=ice-ufrag:client'))
  assert.equal(String((await hostGot)[0]), signal('offer', 'offer', 'v=0\r\na=ice-ufrag:client'))
  const clientGot = once(client, 'message')
  host.send(signal('answer', 'answer', 'v=0\r\na=ice-ufrag:host'))
  assert.equal(String((await clientGot)[0]), signal('answer', 'answer', 'v=0\r\na=ice-ufrag:host'))

  const intruder = new WebSocket(url(room, 'client'))
  assert.equal((await once(intruder, 'close'))[0], 4409)
  await assert.rejects(once(new WebSocket(url(room, 'spy')), 'open'))
  await assert.rejects(once(new WebSocket('ws://127.0.0.1:' + PORT + '/r/short?role=host'), 'open'))

  // This is a signaling server, not a hidden data relay. Binary and arbitrary
  // text frames are protocol violations, even when they are small.
  const binary = await open(url('b'.repeat(32), 'host'))
  binary.send(Buffer.from([1, 2, 3]))
  assert.equal((await once(binary, 'close'))[0], 4400)
  const arbitrary = await open(url('c'.repeat(32), 'host'))
  arbitrary.send('not-a-signal-envelope')
  assert.equal((await once(arbitrary, 'close'))[0], 4400)

  const disguised = await open(url('d'.repeat(32), 'host'))
  disguised.send(JSON.stringify({ type: 'signal', phase: 'sdp', payload: Buffer.from('application data').toString('base64url') }))
  assert.equal((await once(disguised, 'close'))[0], 4400)
  const legacyHello = await open(url('e'.repeat(32), 'host'))
  legacyHello.send(signal('offer', 'offer', 'v=0', 'hello'))
  assert.equal((await once(legacyHello, 'close'))[0], 4400)

  const big = new WebSocket(url('f'.repeat(32), 'host'))
  await once(big, 'open')
  big.send(signal('offer', 'offer', 'v=0\r\n' + 'x'.repeat(70 * 1024)))
  assert.equal((await once(big, 'close'))[0], 1009)

  client.close()
  await new Promise((r) => setTimeout(r, 100))
  assert.equal(host.readyState, WebSocket.OPEN)
  host.close()

  console.log('ALL SIGNALING TESTS PASSED')
} finally {
  proc.kill()
}
