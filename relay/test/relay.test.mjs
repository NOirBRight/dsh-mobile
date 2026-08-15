// Local relay behavior test: two clients through one room.
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

try {
  const health = await fetch('http://127.0.0.1:' + PORT + '/healthz')
  assert.equal(health.status, 200)
  assert.equal(await health.text(), 'ok')
  const nf = await fetch('http://127.0.0.1:' + PORT + '/nope')
  assert.equal(nf.status, 404)

  const host = await open(url(room, 'host'))
  const client = await open(url(room, 'client'))
  const hostGot = once(host, 'message')
  client.send('ping')
  assert.equal(String((await hostGot)[0]), 'ping')
  const clientGot = once(client, 'message')
  host.send('pong')
  assert.equal(String((await clientGot)[0]), 'pong')

  const binGot = once(host, 'message')
  client.send(Buffer.from([1, 2, 3, 255]))
  const [data, isBinary] = await binGot
  assert.ok(isBinary)
  assert.deepEqual([...data], [1, 2, 3, 255])

  const intruder = new WebSocket(url(room, 'client'))
  const [code] = await once(intruder, 'close')
  assert.equal(code, 4409)

  await assert.rejects(once(new WebSocket(url(room, 'spy')), 'open'))
  await assert.rejects(once(new WebSocket('ws://127.0.0.1:' + PORT + '/r/short?role=host'), 'open'))

  const big = new WebSocket(url('b'.repeat(32), 'host'))
  await once(big, 'open')
  big.send(Buffer.alloc(2 * 1024 * 1024))
  const [bigCode] = await once(big, 'close')
  assert.equal(bigCode, 1009)

  client.close()
  await new Promise((r) => setTimeout(r, 100))
  assert.equal(host.readyState, WebSocket.OPEN)
  host.close()

  console.log('ALL RELAY TESTS PASSED')
} finally {
  proc.kill()
}
