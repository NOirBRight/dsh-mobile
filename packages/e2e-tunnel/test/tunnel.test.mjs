// Self-contained end-to-end tests: in-process fake relay + fake host.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import nacl from 'tweetnacl'
import { connect, parseOffer, TunnelError, TunnelWebSocket } from '../src/index.ts'
import { b64urlEncode, utf8Encode } from '../src/bytes.ts'
import { startFakeRelay } from './fake-relay.mjs'
import { startFakeHost } from './fake-host.mjs'

let relay
before(async () => { relay = await startFakeRelay() })
after(() => relay.close())

const newRoom = () => randomBytes(16).toString('hex')
const makeOffer = (over = {}) => 'https://app.noirbright.top/#offer=' + b64urlEncode(utf8Encode(JSON.stringify({
  v: 2, mode: 'relay', addr: relay.url, room: newRoom(),
  pubkey: over.pubkey ?? 'AAAA', code: 'test-code', exp: Math.floor(Date.now() / 1000) + 300,
  ...over,
})))

/** Spin up a host and return a connect-ready offer. */
async function hostAndOffer(opts = {}) {
  const room = newRoom()
  const host = await startFakeHost(relay.url, room, opts)
  const offer = makeOffer({ room, pubkey: host.pubkey, code: opts.expectedCode ?? 'test-code' })
  return { host, offer }
}

// ── offer parsing ────────────────────────────────────────────────────────────

test('parseOffer accepts a valid offer URL', () => {
  const o = parseOffer(makeOffer({ pubkey: b64urlEncode(new Uint8Array(32)) }))
  assert.equal(o.v, 2)
  assert.equal(o.mode, 'relay')
  assert.match(o.room, /^[0-9a-f]{32}$/)
})
test('parseOffer rejects malformed payloads', () => {
  assert.throws(() => parseOffer('https://x/#offer=not-json!!!'), (e) => e instanceof TunnelError && e.code === 'bad-offer')
  assert.throws(() => parseOffer(makeOffer({ v: 1 })), (e) => e.code === 'bad-offer')
  assert.throws(() => parseOffer(makeOffer({ room: 'short' })), (e) => e.code === 'bad-offer')
})
test('parseOffer rejects an expired offer', () => {
  const expired = makeOffer({ exp: Math.floor(Date.now() / 1000) - 10, pubkey: b64urlEncode(new Uint8Array(32)) })
  assert.throws(() => parseOffer(expired), (e) => e.code === 'expired')
})

// ── v3 direct offers (WebRTC DataChannel; room is signaling-only) ─────────

const makeDirectOffer = (over = {}) => 'https://app.noirbright.top/#offer=' + b64urlEncode(utf8Encode(JSON.stringify({
  v: 3, mode: 'direct', addr: 'wss://relay.noirbright.top', room: randomBytes(16).toString('hex'),
  pubkey: b64urlEncode(new Uint8Array(32)), code: 'test-code', exp: Math.floor(Date.now() / 1000) + 300,
  ...over,
})))

test('parseOffer accepts a v3 direct offer with STUN-only ice', () => {
  const o = parseOffer(makeDirectOffer({ ice: ['stun:stun.example.com:3478', 'stuns://stun.example.com:5349'] }))
  assert.equal(o.v, 3)
  assert.equal(o.mode, 'direct')
  assert.deepEqual(o.ice, ['stun:stun.example.com:3478', 'stuns://stun.example.com:5349'])
  assert.match(o.room, /^[0-9a-f]{32}$/)
})

test('parseOffer accepts a v3 direct offer without ice', () => {
  const o = parseOffer(makeDirectOffer())
  assert.equal(o.v, 3)
  assert.equal(o.mode, 'direct')
  assert.equal(o.ice, undefined)
})

test('parseOffer rejects v3 shape violations', () => {
  // version/mode mismatch, both directions
  assert.throws(() => parseOffer(makeDirectOffer({ mode: 'relay' })), (e) => e.code === 'bad-offer')
  assert.throws(() => parseOffer(makeOffer({ v: 3, mode: 'direct' })), (e) => e.code === 'bad-offer')
  // TURN is never accepted — there is no relay fallback by design
  assert.throws(() => parseOffer(makeDirectOffer({ ice: ['turn:turn.example.com:3478'] })), (e) => e.code === 'bad-offer')
  assert.throws(() => parseOffer(makeDirectOffer({ ice: ['stun:ok.example.com', 'turns://no.example.com'] })), (e) => e.code === 'bad-offer')
  // ice shape: must be an array of strings
  assert.throws(() => parseOffer(makeDirectOffer({ ice: 'stun:stun.example.com' })), (e) => e.code === 'bad-offer')
  assert.throws(() => parseOffer(makeDirectOffer({ ice: [42] })), (e) => e.code === 'bad-offer')
  // ice is a v3 field only
  assert.throws(() => parseOffer(makeOffer({ ice: ['stun:stun.example.com'] })), (e) => e.code === 'bad-offer')
  // room stays mandatory on v3
  assert.throws(() => parseOffer(makeDirectOffer({ room: null })), (e) => e.code === 'bad-offer')
})

const publicCapabilities = { browser: true, direct: true, tunnel: true, endpointRefresh: true }
const makePublicOffer = (over = {}) => 'https://host.example/#offer=' + b64urlEncode(utf8Encode(JSON.stringify({
  v: 4, mode: 'public', protocol: 1, endpoint: 'https://host.example', endpointKind: 'temporary',
  room: randomBytes(16).toString('hex'), pubkey: b64urlEncode(new Uint8Array(32)), code: 'test-code',
  exp: Math.floor(Date.now() / 1000) + 300, ice: ['stun:stun.example.com:3478'],
  capabilities: publicCapabilities, ...over,
})))

test('parseOffer accepts a v4 Host-owned Public Endpoint offer', () => {
  const o = parseOffer(makePublicOffer())
  assert.equal(o.v, 4)
  assert.equal(o.mode, 'public')
  assert.equal(o.protocol, 1)
  assert.equal(o.endpoint, 'https://host.example')
  assert.equal(o.endpointKind, 'temporary')
  assert.deepEqual(o.capabilities, publicCapabilities)
  assert.deepEqual(o.ice, ['stun:stun.example.com:3478'])
})

test('parseOffer expands compact v4 QR payloads below the previous scanner-safe size', () => {
  const compact = [4, 'https://host.example', 0, 'a'.repeat(32), b64urlEncode(new Uint8Array(32)), 'test-code', Math.floor(Date.now() / 1000) + 300, 15, ['stun:stun.example.com:3478']]
  const url = 'dsh-mobile://pair#offer=' + b64urlEncode(utf8Encode(JSON.stringify(compact)))
  assert.ok(url.length < 377)
  const offer = parseOffer(url)
  assert.equal(offer.v, 4)
  assert.equal(offer.endpointKind, 'temporary')
  assert.deepEqual(offer.capabilities, publicCapabilities)
  assert.deepEqual(offer.ice, ['stun:stun.example.com:3478'])
})

test('parseOffer rejects unsafe or malformed v4 Public Endpoint offers', () => {
  assert.throws(() => parseOffer(makePublicOffer({ endpoint: 'http://host.example' })), (e) => e.code === 'bad-offer')
  assert.throws(() => parseOffer(makePublicOffer({ endpointKind: 'managed' })), (e) => e.code === 'bad-offer')
  assert.throws(() => parseOffer(makePublicOffer({ capabilities: { ...publicCapabilities, tunnel: 'yes' } })), (e) => e.code === 'bad-offer')
  assert.throws(() => parseOffer(makePublicOffer({ ice: ['turn:turn.example.com'] })), (e) => e.code === 'bad-offer')
  assert.throws(() => parseOffer(makePublicOffer({ mode: 'direct' })), (e) => e.code === 'bad-offer')
})


// ── handshake ────────────────────────────────────────────────────────────────

test('handshake with one-time code pairs the device and yields a deviceToken', async () => {
  const { offer } = await hostAndOffer()
  const tokens = []
  const states = []
  const client = await connect(offer, { onDeviceToken: (t) => tokens.push(t), onStateChange: (s) => states.push(s) })
  assert.equal(client.state, 'open')
  assert.equal(client.deviceToken, 'dev-1') // issued at first pairing, then permanent
  assert.deepEqual(tokens, ['dev-1'])
  assert.deepEqual(states, ['connecting', 'open'])
  client.close()
  assert.equal(client.state, 'closed')
})

test('first pairing does not report open before durable token persistence finishes', async () => {
  const { offer } = await hostAndOffer()
  let release
  let callbackEntered
  let connected = false
  const persisted = new Promise(resolve => { release = resolve })
  const entered = new Promise(resolve => { callbackEntered = resolve })
  const pending = connect(offer, {
    onDeviceToken: async () => { callbackEntered(); await persisted },
  })
  void pending.then(() => { connected = true })
  await entered
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(connected, false)
  release()
  const client = await pending
  client.close()
})

test('same Client Instance key retries a claimed offer without minting another device', async () => {
  const { offer } = await hostAndOffer()
  const clientKeypair = nacl.box.keyPair()
  const first = await connect(offer, { clientKeypair })
  const token = first.deviceToken
  first.close()
  const retry = await connect(offer, { clientKeypair })
  assert.equal(retry.deviceToken, token)
  retry.close()
})

test('handshake rejects a bad code with the host error', async () => {
  const { offer } = await hostAndOffer({ expectedCode: 'right-code' })
  const parsed = parseOffer(offer)
  const wrong = makeOffer({ room: parsed.room, pubkey: parsed.pubkey, code: 'wrong-code' })
  await assert.rejects(connect(wrong), (e) => e instanceof TunnelError && e.code === 'bad-code')
})

test('handshake times out when no host answers', async () => {
  const offer = makeOffer({ pubkey: b64urlEncode(new Uint8Array(32)) })
  await assert.rejects(connect(offer, { handshakeTimeoutMs: 300 }), (e) => e.code === 'timeout')
})

test('heartbeat probe round-trips inside the encrypted session', async () => {
  const { offer } = await hostAndOffer()
  const client = await connect(offer)
  await client.probe(500)
  assert.equal(client.state, 'open')
  client.close()
})

// ── tunneled fetch ───────────────────────────────────────────────────────────

test('fetch round-trips a POST through the tunnel', async () => {
  const { offer, host } = await hostAndOffer()
  const client = await connect(offer)
  const res = await client.fetch('/api/echo', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hello: 'tunnel' }),
  })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.method, 'POST')
  assert.equal(body.path, '/api/echo')
  assert.equal(body.echo, JSON.stringify({ hello: 'tunnel' }))
  assert.equal(host.seen.requests[0].path, '/api/echo')
  client.close()
})

test('fetch assembles a chunked (http-data) response', async () => {
  const { offer } = await hostAndOffer()
  const client = await connect(offer)
  const res = await client.fetch('/api/large')
  assert.equal(res.status, 200)
  const buf = new Uint8Array(await res.arrayBuffer())
  assert.equal(buf.length, 300 * 1024)
  assert.equal(buf[0], 0)
  assert.equal(buf[251], 0)
  assert.equal(buf[300 * 1024 - 1], (300 * 1024 - 1) % 251)
  client.close()
})

test('fetch chunks an oversized request body via http-data', async () => {
  const { offer } = await hostAndOffer()
  const client = await connect(offer)
  const body = new Uint8Array(250 * 1024)
  for (let i = 0; i < body.length; i++) body[i] = i % 256
  const res = await client.fetch('/api/upload', { method: 'POST', body })
  let sum = 0
  for (const b of body) sum = (sum + b) % 100000
  assert.deepEqual(await res.json(), { received: body.length, checksum: sum })
  client.close()
})

test('fetch handles empty and error responses', async () => {
  const { offer } = await hostAndOffer()
  const client = await connect(offer)
  const empty = await client.fetch('/api/empty')
  assert.equal(empty.status, 204)
  assert.equal(await empty.text(), '')
  const missing = await client.fetch('/api/nope')
  assert.equal(missing.status, 404)
  assert.equal(await missing.text(), 'not found')
  client.close()
})

test('fetch rejects a body over the 8 MiB cap before sending', async () => {
  const { offer } = await hostAndOffer()
  const client = await connect(offer)
  await assert.rejects(client.fetch('/api/upload', { method: 'POST', body: new Uint8Array(9 * 1024 * 1024) }),
    (e) => e.code === 'too-large')
  client.close()
})

// ── WebSocketLike ────────────────────────────────────────────────────────────

test('tunneled WebSocket delivers open/messages/echo/close', async () => {
  const { offer } = await hostAndOffer()
  const client = await connect(offer)
  const sock = client.openWebSocket('/ws/echo')
  const events = []
  sock.addEventListener('open', () => events.push(['open', sock.readyState]))
  sock.addEventListener('message', (ev) => events.push(['msg', ev.data]))
  sock.addEventListener('close', (ev) => events.push(['close', ev.code]))
  assert.equal(sock.readyState, TunnelWebSocket.CONNECTING)
  assert.equal(TunnelWebSocket.OPEN, 1)
  await new Promise((resolve) => {
    const seen = []
    sock.addEventListener('message', (ev) => {
      seen.push(ev.data)
      if (seen.length === 2) resolve()
    })
  })
  sock.send('hi')
  await new Promise((resolve) => {
    sock.addEventListener('message', (ev) => { if (ev.data === 'echo:hi') resolve() })
  })
  assert.deepEqual(events[0], ['open', 1])
  assert.deepEqual(events.slice(1, 3), [['msg', 'hello-1'], ['msg', 'hello-2']])
  sock.close(1000, 'done')
  assert.equal(sock.readyState, TunnelWebSocket.CLOSED)
  assert.deepEqual(events.at(-1), ['close', 1000])
  client.close()
})

test('tunneled WebSocket surfaces host refusal as error + close', async () => {
  const { offer } = await hostAndOffer()
  const client = await connect(offer)
  const sock = client.openWebSocket('/ws/nope')
  const seen = []
  sock.addEventListener('error', (ev) => seen.push(['error', ev.message]))
  sock.addEventListener('close', (ev) => seen.push(['close', ev.code]))
  await new Promise((resolve) => sock.addEventListener('close', resolve))
  assert.deepEqual(seen, [['error', 'no such path'], ['close', 1006]])
  client.close()
})

// ── protocol violations ──────────────────────────────────────────────────────

test('a host-side seq gap closes the tunnel and fails pending work', async () => {
  const { offer } = await hostAndOffer()
  const states = []
  const client = await connect(offer, { onStateChange: (s) => states.push(s) })
  await assert.rejects(client.fetch('/api/seqgap'), (e) => e.code === 'closed')
  assert.equal(client.state, 'closed')
  assert.deepEqual(states, ['connecting', 'open', 'closed'])
  await assert.rejects(client.fetch('/api/echo'), (e) => e.code === 'closed')
})

// ── reconnect with deviceToken (permanent until revoked, protocol §5) ────────

test('deviceToken reconnects indefinitely; unknown tokens and the burned code are refused', async () => {
  const { offer } = await hostAndOffer()
  const first = await connect(offer)
  const token = first.deviceToken
  assert.equal(typeof token, 'string')
  first.close()

  const second = await connect(offer, { deviceToken: token })
  assert.equal(second.state, 'open')
  assert.equal(second.deviceToken, token) // bearer token persists — no rotation

  // the reconnected tunnel is fully functional
  const res = await second.fetch('/api/echo', { method: 'POST', body: 'after-reconnect' })
  assert.equal((await res.json()).echo, 'after-reconnect')
  second.close()

  // the seat is free (one client per room); unknown tokens are refused —
  // connect() retries absorb the 4409 release lag
  await assert.rejects(connect(offer, { deviceToken: 'no-such-token' }), (e) => e.code === 'bad-token')

  // The offer is already claimed by the first Client Instance. A new key
  // cannot use it to create another authorization.
  await assert.rejects(connect(offer), (e) => e.code === 'bad-code')
})

test('a paired device reconnects after its original QR offer expires', async () => {
  const { offer } = await hostAndOffer()
  const first = await connect(offer)
  const token = first.deviceToken
  assert.equal(typeof token, 'string')
  first.close()

  const parsed = parseOffer(offer)
  const expired = makeOffer({
    room: parsed.room,
    pubkey: parsed.pubkey,
    exp: Math.floor(Date.now() / 1000) - 1,
  })
  const resumed = await connect(expired, { deviceToken: token })
  assert.equal(resumed.state, 'open')
  assert.equal(resumed.deviceToken, token)
  resumed.close()
})
