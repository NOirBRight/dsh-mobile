import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter, once } from 'node:events'
import http from 'node:http'
import nacl from 'tweetnacl'
import { RTCPeerConnection } from 'werift'
import { DataChannelTransport, decodeSignal, encodeSignal, openSession } from '@dsh-mobile/e2e-tunnel'
import { attachDirectSignaling } from '../src/direct-signaling.ts'
import { WeriftDataChannelTransport } from '../src/webrtc-transport.ts'
import { attachHandshakeTransport } from '../src/tunnel-server.ts'

class FakeSignalSocket extends EventEmitter {
  sent = []
  send(value) { this.sent.push(String(value)); this.emit('sent') }
  close() { this.emit('close') }
}

const deadline = (promise, ms = 10_000) => Promise.race([
  promise, new Promise((_, reject) => setTimeout(() => reject(new Error('deadline exceeded')), ms)),
])

test('signaling socket exchanges SDP then hands off a direct DataChannel', async () => {
  const socket = new FakeSignalSocket()
  let resolveHostChannel
  const hostChannel = new Promise(resolve => { resolveHostChannel = resolve })
  const gate = attachDirectSignaling(socket, {
    iceServers: [],
    onChannel: resolveHostChannel,
  })
  const client = new RTCPeerConnection({ iceServers: [] })
  const channel = client.createDataChannel('dsh-tunnel', { ordered: true })
  await client.setLocalDescription(await client.createOffer())
  socket.emit('message', Buffer.from(encodeSignal({ kind: 'offer', description: client.localDescription })), false)
  if (socket.sent.length === 0) await once(socket, 'sent')
  const answer = decodeSignal(socket.sent[0])
  assert.equal(answer.kind, 'answer')
  await client.setRemoteDescription(answer.description)
  const remote = await deadline(hostChannel)
  await deadline(new Promise(resolve => { if (channel.readyState === 'open') resolve(); else channel.onopen = resolve }))
  const received = deadline(new Promise(resolve => remote.onMessage.subscribe(resolve)))
  channel.send(Buffer.from('direct-signal-ok'))
  assert.equal(String(await received), 'direct-signal-ok')
  gate.close(); await client.close()
})


test('DSH HTTP crosses signaling-only WebRTC with NaCl authentication', async (t) => {
  const upstream = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ path: req.url, host: req.headers.host }))
  })
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve))
  t.after(() => upstream.close())
  const hostKeys = nacl.box.keyPair()
  const socket = new FakeSignalSocket()
  let hostGate
  let signalError
  const signalGate = attachDirectSignaling(socket, {
    iceServers: [],
    onError: error => { signalError = error; socket.emit('sent') },
    onChannel: channel => {
      hostGate = attachHandshakeTransport(new WeriftDataChannelTransport(channel), {
        upstreamHost: '127.0.0.1',
        upstreamPort: upstream.address().port,
        handshake: {
          keypair: { secretKeyRaw: hostKeys.secretKey, publicKeyRaw: hostKeys.publicKey },
          offers: { claim: (code, _claimant, issue) => code === 'good-code' ? { status: 'ok', deviceToken: issue() } : { status: 'unknown' } },
          devices: { issue: () => ({ token: 'phone-token' }), authenticate: () => null, bindRoom() {} },
        },
      })
    },
  })
  t.after(() => { hostGate?.close(); signalGate.close() })

  const clientPeer = new RTCPeerConnection({ iceServers: [] })
  t.after(() => clientPeer.close())
  const clientChannel = clientPeer.createDataChannel('dsh-tunnel', { ordered: true })
  await clientPeer.setLocalDescription(await clientPeer.createOffer())
  socket.emit('message', Buffer.from(encodeSignal({ kind: 'offer', description: clientPeer.localDescription })), false)
  if (socket.sent.length === 0) await deadline(once(socket, 'sent'), 2_000)
  if (signalError !== undefined) throw signalError
  const answer = decodeSignal(socket.sent[0])
  await clientPeer.setRemoteDescription(answer.description)
  await deadline(new Promise(resolve => { if (clientChannel.readyState === 'open') resolve(); else clientChannel.onopen = resolve }), 2_000)

  const listeners = { message: [], close: [] }
  clientChannel.onMessage.subscribe(data => listeners.message.forEach(fn => fn({ data })))
  clientChannel.stateChanged.subscribe(state => { if (state === 'closed') listeners.close.forEach(fn => fn({})) })
  const clientLike = {
    binaryType: 'arraybuffer',
    send(data) { clientChannel.send(Buffer.from(data)) },
    close() { clientChannel.close() },
    addEventListener(type, listener) { listeners[type]?.push(listener) },
  }
  const client = await deadline(openSession(new DataChannelTransport(clientLike), hostKeys.publicKey, { code: 'good-code' }), 2_000)
  t.after(() => client.close())
  assert.equal(client.deviceToken, 'phone-token')
  const response = await client.fetch('/api/direct')
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { path: '/api/direct', host: '127.0.0.1:' + upstream.address().port })
})

test('signaling gate ignores non-offer application payloads', async () => {
  const socket = new FakeSignalSocket()
  const errors = []
  const gate = attachDirectSignaling(socket, { iceServers: [], onChannel() {}, onError: error => errors.push(error.message) })
  socket.emit('message', Buffer.from(encodeSignal({ kind: 'answer', description: { type: 'answer', sdp: 'x' } })), false)
  await new Promise(resolve => setImmediate(resolve))
  assert.match(errors[0], /expected an offer/)
  assert.equal(socket.sent.length, 0)
  gate.close()
})
