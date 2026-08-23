// Seated sockets stay up across missed WebSocket pongs. A later join for the
// same role replaces a zombie so the phone can reopen without waiting.
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createConnection } from 'node:net'
import { randomBytes } from 'node:crypto'
import assert from 'node:assert/strict'
import WebSocket from 'ws'

const PORT = 18788
const proc = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, PORT: String(PORT), PING_INTERVAL_MS: '100' },
  stdio: 'pipe',
})
await new Promise((resolve, reject) => {
  proc.once('error', reject)
  proc.stdout.once('data', resolve)
})

function maskFrame(opcode, payload) {
  const mask = randomBytes(4)
  const body = Buffer.from(payload)
  for (let i = 0; i < body.length; i++) body[i] ^= mask[i & 3]
  const header = Buffer.alloc(6)
  header[0] = 0x80 | opcode
  header[1] = 0x80 | body.length
  mask.copy(header, 2)
  return Buffer.concat([header, body])
}

async function openNoPong(path) {
  const key = randomBytes(16).toString('base64')
  const socket = createConnection({ port: PORT, host: '127.0.0.1' })
  await once(socket, 'connect')
  socket.write(
    'GET ' + path + ' HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ' + key + '\r\n\r\n',
  )
  let buf = Buffer.alloc(0)
  await new Promise((resolve, reject) => {
    const onData = chunk => {
      buf = Buffer.concat([buf, chunk])
      const idx = buf.indexOf('\r\n\r\n')
      if (idx === -1) return
      socket.off('data', onData)
      if (!buf.subarray(0, idx).toString().includes('101')) reject(new Error(buf.toString()))
      else resolve()
    }
    socket.on('data', onData)
    socket.once('error', reject)
  })
  return socket
}

try {
  const room = 'e'.repeat(32)
  const host = new WebSocket('ws://127.0.0.1:' + PORT + '/r/' + room + '?role=host')
  await once(host, 'open')
  const talking = await openNoPong('/r/' + room + '?role=client')
  const received = []
  host.on('message', data => received.push(Buffer.from(data)))
  const talk = setInterval(() => talking.write(maskFrame(0x2, Buffer.from([7, 7]))), 40)
  await new Promise(resolve => setTimeout(resolve, 450))
  assert.equal(talking.destroyed, false)
  assert.ok(received.length > 0)

  clearInterval(talk)
  talking.destroy()
  host.close()

  const silentRoom = 'f'.repeat(32)
  const silentHost = new WebSocket('ws://127.0.0.1:' + PORT + '/r/' + silentRoom + '?role=host')
  await once(silentHost, 'open')
  const silent = await openNoPong('/r/' + silentRoom + '?role=client')
  await new Promise(resolve => setTimeout(resolve, 450))
  assert.equal(silent.destroyed, false)
  assert.notEqual(silent.readyState, 'closed')

  const dropped = Promise.race([
    once(silent, 'close'),
    once(silent, 'end'),
    once(silent, 'error'),
  ])
  const replacement = new WebSocket('ws://127.0.0.1:' + PORT + '/r/' + silentRoom + '?role=client')
  await once(replacement, 'open')
  await dropped
  assert.equal(silent.destroyed || silent.readyState === 'closed', true)
  const resumed = []
  silentHost.on('message', data => resumed.push(Buffer.from(data)))
  replacement.send(Buffer.from([9, 9]))
  await once(silentHost, 'message')
  assert.deepEqual(resumed[0], Buffer.from([9, 9]))

  silentHost.close()
  replacement.close()
  silent.destroy()
  console.log('KEEPALIVE TESTS PASSED')
} finally {
  proc.kill()
}
