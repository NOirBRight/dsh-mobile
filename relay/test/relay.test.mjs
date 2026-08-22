// Official Relay behavior: opaque binary frames, many isolated rooms.
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import assert from 'node:assert/strict'
import WebSocket from 'ws'

const PORT = 18787
const proc = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'pipe' })
await new Promise((resolve, reject) => {
  proc.once('error', reject)
  proc.stdout.once('data', resolve)
})

const url = (room, role) => 'ws://127.0.0.1:' + PORT + '/r/' + room + '?role=' + role
const open = async (target) => {
  const ws = new WebSocket(target)
  await once(ws, 'open')
  return ws
}
const closeCode = async (ws) => (await once(ws, 'close'))[0]

try {
  const health = await fetch('http://127.0.0.1:' + PORT + '/healthz')
  assert.equal(health.status, 200)
  assert.equal(await health.text(), 'ok')
  assert.equal((await fetch('http://127.0.0.1:' + PORT + '/nope')).status, 404)

  const room = 'a'.repeat(32)
  const host = await open(url(room, 'host'))
  const client = await open(url(room, 'client'))
  const hostFrame = Buffer.from([1, 2, 3, 4])
  const hostGot = once(host, 'message')
  client.send(hostFrame)
  assert.deepEqual(Buffer.from((await hostGot)[0]), hostFrame)
  const clientFrame = Buffer.from([9, 8, 7])
  const clientGot = once(client, 'message')
  host.send(clientFrame)
  assert.deepEqual(Buffer.from((await clientGot)[0]), clientFrame)

  const secondRoom = 'b'.repeat(32)
  const secondHost = await open(url(secondRoom, 'host'))
  const secondClient = await open(url(secondRoom, 'client'))
  const secondGot = once(secondHost, 'message')
  secondClient.send(Buffer.from('independent-room'))
  assert.equal(String((await secondGot)[0]), 'independent-room')

  const intruder = new WebSocket(url(room, 'client'))
  assert.equal(await closeCode(intruder), 4409)
  await assert.rejects(once(new WebSocket(url(room, 'spy')), 'open'))
  await assert.rejects(once(new WebSocket('ws://127.0.0.1:' + PORT + '/r/short?role=host'), 'open'))

  const text = await open(url('c'.repeat(32), 'host'))
  text.send('not-a-sealed-frame')
  assert.equal(await closeCode(text), 4400)

  const large = await open(url('d'.repeat(32), 'host'))
  large.send(Buffer.alloc(300 * 1024))
  assert.equal(await closeCode(large), 1009)

  client.close(); host.close(); secondClient.close(); secondHost.close()
  console.log('ALL OPAQUE RELAY TESTS PASSED')
} finally {
  proc.kill()
}
