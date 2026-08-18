// v3 'direct' negotiation tests: SDP-only signaling over the room socket
// (non-trickle, STUN-only, no TURN/fallback), then the unchanged NaCl
// handshake + session over the negotiated DataChannel. A FakePeerConnection
// stands in for the native RTCPeerConnection; the full-flow test wires it
// through globalThis so connect() itself is exercised end to end.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { connect, negotiateDirectChannel, encodeSignal, decodeSignal, TunnelError, TUNNEL_CHANNEL_LABEL } from '../src/index.ts'
import { b64urlEncode, utf8Encode } from '../src/bytes.ts'

const b64urlJson = (obj) => JSON.stringify({ type: 'signal', phase: 'sdp', payload: b64urlEncode(utf8Encode(JSON.stringify(obj))) })
import { startFakeRelay } from './fake-relay.mjs'
import { FakeDataChannel } from './fake-datachannel.mjs'
import { startFakeDcHost } from './fake-dc-host.mjs'

// ── Fakes ───────────────────────────────────────────────────────────────────

class FakePeerConnection {
  static instances = []
  constructor(config) {
    this.config = config ?? {}
    this.iceGatheringState = 'new'
    this.connectionState = 'new'
    this.localDescription = null
    this.remoteDescription = null
    this.listeners = {}
    this.channel = null
    this.closed = false
    this.autoOpen = true        // false → the channel never opens
    this.failConnection = false // true → connectionState 'failed' on answer
    FakePeerConnection.instances.push(this)
  }

  createDataChannel(label) {
    this.channelLabel = label
    this.channel = new FakeDataChannel()
    return this.channel
  }

  async setLocalDescription() {
    // The SDP embeds the config so tests can assert the STUN-only iceServers.
    this.localDescription = { type: 'offer', sdp: 'fake-offer-sdp:' + JSON.stringify(this.config) }
    this.iceGatheringState = 'gathering'
    queueMicrotask(() => {
      this.iceGatheringState = 'complete'
      this.fire('icegatheringstatechange')
    })
  }

  async setRemoteDescription(desc) {
    this.remoteDescription = desc
    queueMicrotask(() => {
      if (this.failConnection) {
        this.connectionState = 'failed'
        this.fire('connectionstatechange')
        return
      }
      if (this.autoOpen) this.channel.fireOpen()
    })
  }

  addEventListener(type, cb) {
    ;(this.listeners[type] ??= []).push(cb)
  }

  fire(type) {
    for (const cb of this.listeners[type] ?? []) cb()
  }

  close() {
    this.closed = true
  }
}

class FakeSignalingSocket {
  constructor() {
    this.sent = []
    this.listeners = { message: [], close: [] }
    this.closed = false
  }

  send(data) {
    this.sent.push(data)
  }

  addEventListener(type, cb) {
    this.listeners[type].push(cb)
  }

  close() {
    this.closed = true
  }

  fireMessage(data) {
    for (const cb of this.listeners.message) cb({ data })
  }

  fireClose() {
    for (const cb of this.listeners.close) cb({})
  }
}

async function waitFor(cond, timeoutMs = 2000) {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 1))
  }
}

const onceOpen = (ws) => new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true })
  ws.addEventListener('error', () => reject(new Error('ws failed')), { once: true })
})

// ── Envelope codec ──────────────────────────────────────────────────────────

test('the channel label is exactly dsh-tunnel (host closes every other label)', () => {
  assert.equal(TUNNEL_CHANNEL_LABEL, 'dsh-tunnel')
})

test('encodeSignal/decodeSignal round-trip; relay control decodes to null', () => {
  const signal = { kind: 'offer', description: { type: 'offer', sdp: 'v=0 o=- 1 IN IP4 0.0.0.0' } }
  assert.deepEqual(decodeSignal(encodeSignal(signal)), signal)
  assert.equal(decodeSignal(JSON.stringify({ relay: 'peer-left', role: 'host' })), null)
})

test('decodeSignal rejects malformed messages as handshake errors', () => {
  assert.throws(() => decodeSignal('not json'), (e) => e instanceof TunnelError && e.code === 'handshake')
  assert.throws(() => decodeSignal('{"type":"signal","phase":"ice","payload":"x"}'), (e) => e.code === 'handshake')
  assert.throws(() => decodeSignal('{"type":"signal","phase":"sdp","payload":"!!!"}'), (e) => e.code === 'handshake')
  const badKind = encodeSignal({ kind: 'candidate', description: { type: 'offer', sdp: 'x' } })
  assert.throws(() => decodeSignal(badKind), (e) => e.code === 'handshake')
  const emptySdp = encodeSignal({ kind: 'answer', description: { type: 'answer', sdp: '' } })
  assert.throws(() => decodeSignal(emptySdp), (e) => e.code === 'handshake')
  const noDescription = b64urlJson({ kind: 'answer' })
  assert.throws(() => decodeSignal(noDescription), (e) => e.code === 'handshake')
})

// ── Negotiation (unit, fake socket + fake PC) ───────────────────────────────

function newPc(over = {}, config) {
  const pc = new FakePeerConnection(config)
  Object.assign(pc, over)
  return pc
}

test('negotiation sends the offer only after ICE gathering completes, applies the answer', async () => {
  const socket = new FakeSignalingSocket()
  let pc
  let gatheringAtSend = null
  const sent = socket.sent
  const origSend = socket.send.bind(socket)
  socket.send = (d) => { gatheringAtSend = pc.iceGatheringState; origSend(d) }
  const p = negotiateDirectChannel(socket, { ice: ['stun:stun.example.com:3478'], createPeerConnection: (config) => (pc = newPc({}, config)) })
  await waitFor(() => sent.length === 1)
  assert.equal(gatheringAtSend, 'complete') // non-trickle: gathered before the offer left
  assert.deepEqual(pc.config, { iceServers: [{ urls: ['stun:stun.example.com:3478'] }] })
  assert.equal(pc.channelLabel, 'dsh-tunnel')
  const offer = decodeSignal(sent[0])
  assert.equal(offer.kind, 'offer')
  assert.equal(offer.description.type, 'offer')
  assert.match(offer.description.sdp, /^fake-offer-sdp:/)
  socket.fireMessage(encodeSignal({ kind: 'answer', description: { type: 'answer', sdp: 'fake-answer-sdp' } }))
  const negotiated = await p
  assert.equal(negotiated.channel, pc.channel)
  assert.equal(pc.remoteDescription.type, 'answer')
  assert.equal(pc.remoteDescription.sdp, 'fake-answer-sdp')
  negotiated.closePeer()
  assert.equal(pc.closed, true)
  negotiated.closePeer() // idempotent
})

test('negotiation without ice passes no iceServers', async () => {
  const socket = new FakeSignalingSocket()
  let pc
  const p = negotiateDirectChannel(socket, { createPeerConnection: (config) => (pc = newPc({}, config)) })
  await waitFor(() => socket.sent.length === 1)
  assert.deepEqual(pc.config, {})
  socket.fireMessage(encodeSignal({ kind: 'answer', description: { type: 'answer', sdp: 'a' } }))
  await p
})

test('relay control and binary frames are skipped while waiting for the answer', async () => {
  const socket = new FakeSignalingSocket()
  const p = negotiateDirectChannel(socket, { createPeerConnection: (config) => newPc({}, config) })
  await waitFor(() => socket.sent.length === 1)
  socket.fireMessage(new ArrayBuffer(8)) // not text: ignored
  socket.fireMessage(JSON.stringify({ relay: 'peer-joined', role: 'host' }))
  socket.fireMessage(encodeSignal({ kind: 'answer', description: { type: 'answer', sdp: 'a' } }))
  await p // resolves despite the noise
})

test('an offer in reply (glare) is a handshake error', async () => {
  const socket = new FakeSignalingSocket()
  const p = negotiateDirectChannel(socket, { createPeerConnection: (config) => newPc({}, config) })
  await waitFor(() => socket.sent.length === 1)
  socket.fireMessage(encodeSignal({ kind: 'offer', description: { type: 'offer', sdp: 'x' } }))
  await assert.rejects(p, (e) => e instanceof TunnelError && e.code === 'handshake')
})

test('a malformed signal frame fails the negotiation', async () => {
  const socket = new FakeSignalingSocket()
  const p = negotiateDirectChannel(socket, { createPeerConnection: (config) => newPc({}, config) })
  await waitFor(() => socket.sent.length === 1)
  socket.fireMessage('{"type":"signal","phase":"sdp","payload":"!!!"}')
  await assert.rejects(p, (e) => e.code === 'handshake')
})

test('the signaling socket closing mid-negotiation is a handshake error', async () => {
  const socket = new FakeSignalingSocket()
  let pc
  const p = negotiateDirectChannel(socket, { createPeerConnection: (config) => (pc = newPc({}, config)) })
  await waitFor(() => socket.sent.length === 1)
  socket.fireClose()
  await assert.rejects(p, (e) => e.code === 'handshake')
  assert.equal(pc.closed, true) // the failed attempt tears its peer connection down
})

test('no answer within the bound is a timeout', async () => {
  const socket = new FakeSignalingSocket()
  const p = negotiateDirectChannel(socket, { createPeerConnection: (config) => newPc({}, config), timeoutMs: 50 })
  await assert.rejects(p, (e) => e instanceof TunnelError && e.code === 'timeout')
})

test('ICE failure before the channel opens is ice-failed, never a fallback', async () => {
  const socket = new FakeSignalingSocket()
  const pc = newPc({ failConnection: true })
  const p = negotiateDirectChannel(socket, { createPeerConnection: () => pc })
  await waitFor(() => socket.sent.length === 1)
  socket.fireMessage(encodeSignal({ kind: 'answer', description: { type: 'answer', sdp: 'a' } }))
  await assert.rejects(p, (e) => e instanceof TunnelError && e.code === 'ice-failed')
  assert.equal(pc.closed, true)
})

test('a channel that never opens is a timeout, not a hang', async () => {
  const socket = new FakeSignalingSocket()
  const pc = newPc({ autoOpen: false })
  const p = negotiateDirectChannel(socket, { createPeerConnection: () => pc, timeoutMs: 50 })
  await waitFor(() => socket.sent.length === 1)
  socket.fireMessage(encodeSignal({ kind: 'answer', description: { type: 'answer', sdp: 'a' } }))
  await assert.rejects(p, (e) => e.code === 'timeout')
})

// ── Full flow through connect() ─────────────────────────────────────────────

let relay
before(async () => { relay = await startFakeRelay() })
after(() => relay.close())

// Records every WebSocket connect() creates: send frame types and closes.
// Proves direct mode opens exactly one (signaling) socket, sends only text
// on it, keeps it while the peer lives, and closes it with the tunnel.
class SpyWebSocket extends WebSocket {
  static instances = []
  constructor(url, protocols) {
    super(url, protocols)
    this.sentTypes = []
    this.closeCalls = 0
    SpyWebSocket.instances.push(this)
  }

  send(data) {
    this.sentTypes.push(typeof data === 'string' ? 'text' : 'binary')
    super.send(data)
  }

  close(...args) {
    this.closeCalls += 1
    super.close(...args)
  }
}

/** Connect a throwaway socket to the room: true if seated, false if 4409 (seat taken). */
async function roomSeats(url, room, role) {
  const ws = new WebSocket(url + '/r/' + room + '?role=' + role)
  const seated = await new Promise((resolve) => {
    ws.addEventListener('open', () => resolve(true), { once: true })
    ws.addEventListener('close', (ev) => { if (ev.code === 4409) resolve(false) }, { once: true })
  })
  ws.close()
  return seated
}

/** Host half: NaCl endpoint on a DataChannel end + SDP answerer on the room socket. */
async function startDirectHost(room) {
  const hostDc = new FakeDataChannel()
  const host = startFakeDcHost(hostDc)
  const roomFrames = []
  const hostWs = new WebSocket(relay.url + '/r/' + room + '?role=host')
  await onceOpen(hostWs)
  hostWs.addEventListener('message', (ev) => {
    roomFrames.push(ev.data)
    if (typeof ev.data !== 'string') return
    const signal = decodeSignal(ev.data)
    if (signal === null || signal.kind !== 'offer') return
    const pc = FakePeerConnection.instances.at(-1)
    pc.channel.peer = hostDc
    hostDc.peer = pc.channel
    hostWs.send(encodeSignal({ kind: 'answer', description: { type: 'answer', sdp: 'fake-host-answer-sdp' } }))
  })
  return { host, hostDc, hostWs, roomFrames }
}

function makeDirectOfferUrl(room, pubkey, code = 'test-code') {
  return 'https://app.noirbright.top/#offer=' + b64urlEncode(utf8Encode(JSON.stringify({
    v: 3, mode: 'direct', addr: relay.url, room,
    pubkey: b64urlEncode(pubkey), code, exp: Math.floor(Date.now() / 1000) + 300,
    ice: ['stun:stun.example.com:3478'],
  })))
}

/** Install the fakes globally so the real connect() path uses them; restore afterwards. */
async function withDirectFakes(run) {
  FakePeerConnection.instances = []
  SpyWebSocket.instances = []
  const savedWs = globalThis.WebSocket
  const savedPc = globalThis.RTCPeerConnection
  globalThis.RTCPeerConnection = FakePeerConnection
  globalThis.WebSocket = SpyWebSocket
  try {
    await run()
  } finally {
    // Restore, never delete: Node's global WebSocket must survive for later tests.
    globalThis.WebSocket = savedWs
    if (savedPc === undefined) delete globalThis.RTCPeerConnection
    else globalThis.RTCPeerConnection = savedPc
  }
}

test('connect() over a v3 direct offer: signaling carries only SDP, then the sealed session rides the DataChannel', async () => {
  const room = randomBytes(16).toString('hex')
  // Host socket joins BEFORE the spy installs, so only the client's socket is spied.
  const { host, hostWs, roomFrames } = await startDirectHost(room)
  await withDirectFakes(async () => {
    const client = await connect(makeDirectOfferUrl(room, host.pubkey))
    assert.equal(client.state, 'open')
    assert.equal(client.deviceToken, 'tok-1')

    // The sealed session rides the DataChannel end to end.
    const res = await client.fetch('/api/host.describe')
    assert.equal(await res.text(), 'body:GET /api/host.describe')

    // Exactly one socket exists (no binary relay fallback): the signaling
    // socket. It sent exactly one frame, text — the SDP offer. No binary
    // application frame ever touched it; the NaCl hello rode the DataChannel.
    assert.equal(SpyWebSocket.instances.length, 1)
    const signalWs = SpyWebSocket.instances[0]
    assert.deepEqual(signalWs.sentTypes, ['text'])
    assert.equal(roomFrames.length, 1)
    assert.equal(typeof roomFrames[0], 'string')
    const offerSignal = decodeSignal(roomFrames[0])
    assert.equal(offerSignal.kind, 'offer')
    assert.match(offerSignal.description.sdp, /stun:stun\.example\.com:3478/) // STUN-only config reached the PC

    // Signaling stays open while the peer is live.
    assert.equal(signalWs.closeCalls, 0)
    const pc = FakePeerConnection.instances[0]
    assert.equal(pc.remoteDescription.sdp, 'fake-host-answer-sdp')
    assert.equal(pc.closed, false)

    // Tunnel close tears down peer AND signaling socket, releasing the seat.
    client.close()
    assert.equal(pc.closed, true)
    assert.equal(pc.channel.closed, true)
    assert.equal(signalWs.closeCalls, 1)
    assert.equal(await roomSeats(relay.url, room, 'client'), true)
  })
  hostWs.close()
})

test('a dead DataChannel mid-session tears down peer and signaling socket (still no fallback)', async () => {
  const room = randomBytes(16).toString('hex')
  const { host, hostDc, hostWs } = await startDirectHost(room)
  await withDirectFakes(async () => {
    const states = []
    const client = await connect(makeDirectOfferUrl(room, host.pubkey), { onStateChange: (s) => states.push(s) })
    assert.equal(client.state, 'open')
    const pc = FakePeerConnection.instances[0]
    const signalWs = SpyWebSocket.instances[0]

    // The host's channel end dies: the tunnel must close, and with it the
    // peer connection and the signaling socket. No relay path is attempted.
    hostDc.close()
    await waitFor(() => client.state === 'closed')
    assert.equal(pc.closed, true)
    assert.equal(signalWs.closeCalls, 1)
    assert.equal(SpyWebSocket.instances.length, 1) // no fallback socket ever appeared
    assert.deepEqual(states, ['connecting', 'open', 'closed'])
    assert.equal(await roomSeats(relay.url, room, 'client'), true)
  })
  hostWs.close()
})

test('a rejected pairing code over direct fails the attempt and tears everything down', async () => {
  const room = randomBytes(16).toString('hex')
  const { host, hostWs } = await startDirectHost(room)
  await withDirectFakes(async () => {
    const offer = makeDirectOfferUrl(room, host.pubkey, 'wrong-code') // payload is base64url: build it, don't string-patch it
    await assert.rejects(connect(offer), (e) => e instanceof TunnelError && e.code === 'bad-code')
    const pc = FakePeerConnection.instances[0]
    const signalWs = SpyWebSocket.instances[0]
    assert.equal(pc.closed, true)
    assert.equal(signalWs.closeCalls, 1)
    assert.equal(await roomSeats(relay.url, room, 'client'), true)
  })
  hostWs.close()
})
