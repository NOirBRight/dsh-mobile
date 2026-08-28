// DataChannel-adapter tests: the full session (handshake, fetch demux,
// tunneled WebSocket, close semantics) runs over an in-memory DataChannel
// pair — no relay, no WebSocket anywhere in the file.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import nacl from 'tweetnacl'
import { openSession, DataChannelTransport, TunnelError, fragmentFrame, FrameReassembler } from '../src/index.ts'
import { b64decode, b64encode, concat, utf8Decode, utf8Encode } from '../src/bytes.ts'
import { FakeDataChannel } from './fake-datachannel.mjs'
import { startFakeDcHost } from './fake-dc-host.mjs'


/** Pair a fake host with a tunnel client over a fresh DataChannel pair. */
async function hostAndClient(opts = {}) {
  const [hostDc, clientDc] = FakeDataChannel.pair()
  const host = startFakeDcHost(hostDc, {
    expectedCode: opts.expectedCode,
    state: opts.state,
    maxHttpBodyBytes: opts.maxHttpBodyBytes,
    advertiseMaxHttpBodyBytes: opts.advertiseMaxHttpBodyBytes,
  })
  const states = []
  const tokens = []
  const hostNames = []
  const client = await openSession(new DataChannelTransport(clientDc), host.pubkey, {
    code: opts.expectedCode ?? 'test-code',
    deviceToken: opts.deviceToken,
    onStateChange: (s) => states.push(s),
    onDeviceToken: (t) => tokens.push(t),
    onHostMetadata: (metadata) => hostNames.push(metadata.displayName),
  })
  return { host, client, clientDc, hostDc, states, tokens, hostNames }
}

const nextEvent = (target, type) => new Promise((resolve) => {
  target.addEventListener(type, (ev) => resolve(ev), { once: true })
})

// ── Handshake ───────────────────────────────────────────────────────────────

test('openSession handshakes over a DataChannelTransport and issues a device token', async () => {
  const { client, states, tokens, hostNames } = await hostAndClient()
  assert.equal(client.state, 'open')
  assert.equal(client.deviceToken, 'tok-1')
  assert.equal(client.maxHttpBodyBytes, 8 * 1024 * 1024)
  assert.deepEqual(tokens, ['tok-1'])
  assert.deepEqual(hostNames, ['Noir PC'])
  assert.deepEqual(states, ['open'])
  client.close()
})

test('an old Host ack without maxHttpBodyBytes keeps the safe 8 MiB client default', async () => {
  const { client } = await hostAndClient({ advertiseMaxHttpBodyBytes: false })
  assert.equal(client.maxHttpBodyBytes, 8 * 1024 * 1024)
  client.close()
})

test('deviceToken reconnect over a DataChannelTransport keeps the token', async () => {
  const state = { deviceTokens: new Set(), tokenCounter: 0 }
  const first = await hostAndClient({ state })
  assert.equal(first.client.deviceToken, 'tok-1')
  first.client.close()
  // A later session on a fresh channel presents the bearer token instead of a
  // code; the ack carries no new token and the presented one persists.
  const second = await hostAndClient({ state, deviceToken: 'tok-1' })
  assert.equal(second.client.deviceToken, 'tok-1')
  assert.deepEqual(second.tokens, [])
  second.client.close()
})

test('host verdict bad-code rejects the handshake', async () => {
  const [hostDc, clientDc] = FakeDataChannel.pair()
  const host = startFakeDcHost(hostDc)
  await assert.rejects(
    openSession(new DataChannelTransport(clientDc), host.pubkey, { code: 'wrong-code' }),
    (e) => e instanceof TunnelError && e.code === 'bad-code',
  )
})

// ── fetch demux (no relay WebSocket anywhere) ───────────────────────────────

test('fetch demuxes an inline-body response', async () => {
  const { client } = await hostAndClient()
  const res = await client.fetch('/api/host.describe')
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('x-test'), 'yes')
  assert.equal(await res.text(), 'body:GET /api/host.describe')
  client.close()
})

test('fetch assembles chunked http-data frames in order', async () => {
  const { client } = await hostAndClient()
  const res = await client.fetch('/chunked')
  assert.equal(res.status, 200)
  assert.equal(await res.text(), 'chunk-1;chunk-2')
  client.close()
})

test('advertised request limits reject an unknown-length body before any tunnel frames are sent', async () => {
  const { client } = await hostAndClient({ maxHttpBodyBytes: 8 })
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3, 4, 5]))
      controller.enqueue(new Uint8Array([6, 7, 8, 9, 10]))
      controller.close()
    },
  })
  await assert.rejects(client.fetch('/upload', { method: 'POST', body }), (error) => {
    assert.equal(error.code, 'too-large')
    assert.deepEqual(error.details, { direction: 'request', maxHttpBodyBytes: 8, actualHttpBodyBytes: 10 })
    assert.match(error.message, /8 bytes/)
    return true
  })
  const res = await client.fetch('/tiny')
  assert.equal(res.status, 200, 'the rejected body did not consume a tunnel sequence number')
  client.close()
})

test('chunked responses are bounded by the negotiated HTTP body limit', async () => {
  const { client } = await hostAndClient({ maxHttpBodyBytes: 8 })
  await assert.rejects(client.fetch('/oversized-chunked'), (error) => {
    assert.equal(error.code, 'too-large')
    assert.deepEqual(error.details, { direction: 'response', maxHttpBodyBytes: 8, actualHttpBodyBytes: 10 })
    return true
  })
  assert.equal(client.state, 'open')
  client.close()
})

test('frames delivered as Blobs keep seq order (async normalization queue)', async () => {
  const { client, clientDc } = await hostAndClient()
  clientDc.blobMode = true // every host→client frame now arrives as a Blob
  for (let i = 0; i < 5; i++) {
    const res = await client.fetch('/api/seq/' + i)
    assert.equal(await res.text(), 'body:GET /api/seq/' + i)
  }
  assert.equal(client.state, 'open') // a seq violation would have closed the session
  client.close()
})

// ── Tunneled WebSocket over the DataChannel ────────────────────────────────

test('tunneled WebSocket opens, echoes, and closes', async () => {
  const { client } = await hostAndClient()
  const sock = client.openWebSocket('/api/remote.mux')
  await nextEvent(sock, 'open')
  assert.equal(sock.readyState, 1)
  const received = []
  sock.addEventListener('message', (ev) => received.push(ev.data))
  sock.send('ping-1')
  sock.send('ping-2')
  sock.send(new Uint8Array([1, 2, 3]))
  const closed = nextEvent(sock, 'close')
  // Preserve WebSocket message type in both directions: remote.mux requires
  // text JSON, while binary callers still receive an ArrayBuffer.
  while (received.length < 3) await new Promise((r) => setTimeout(r, 1))
  assert.deepEqual(received.slice(0, 2), ['ping-1', 'ping-2'])
  assert.ok(received[2] instanceof ArrayBuffer)
  assert.deepEqual([...new Uint8Array(received[2])], [1, 2, 3])
  sock.close(1000, 'done')
  const ev = await closed
  assert.equal(ev.code, 1000)
  assert.equal(ev.reason, 'done')
  client.close()
})

// ── Close semantics ─────────────────────────────────────────────────────────

test('transport close aborts in-flight fetch, closes sockets with 1006, flips state', async () => {
  const { client, hostDc, states } = await hostAndClient()
  const sock = client.openWebSocket('/api/events.mux')
  await nextEvent(sock, 'open')
  const sockClosed = nextEvent(sock, 'close')
  const hung = client.fetch('/hang')
  const assertion = assert.rejects(hung, (e) => e instanceof TunnelError && e.code === 'closed')
  hostDc.close()
  await assertion
  const ev = await sockClosed
  assert.equal(ev.code, 1006)
  assert.equal(client.state, 'closed')
  assert.deepEqual(states, ['open', 'closed'])
  await assert.rejects(client.fetch('/api/host.describe'), (e) => e instanceof TunnelError && e.code === 'closed')
})

test('client.close() closes the transport and rejects new work', async () => {
  const { client, hostDc } = await hostAndClient()
  client.close()
  assert.equal(client.state, 'closed')
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(hostDc.closed, true) // close propagated across the pair
  await assert.rejects(client.fetch('/x'), (e) => e.code === 'closed')
})

// ── Adapter units ───────────────────────────────────────────────────────────

test('DataChannelTransport: send wraps frames in the codec header, onFrame is single-slot', async () => {
  const [a, b] = FakeDataChannel.pair()
  const transport = new DataChannelTransport(a)
  const seen = []
  b.addEventListener('message', (ev) => seen.push(new Uint8Array(ev.data)))
  transport.send(utf8Encode('frame-1'))
  transport.send(utf8Encode('frame-2'))
  await new Promise((r) => setTimeout(r, 10))
  // One wire message each: tag 0x00 (whole) + frame bytes.
  assert.equal(seen.length, 2)
  assert.deepEqual(seen.map((m) => m[0]), [0, 0])
  assert.deepEqual(seen.map((m) => utf8Decode(m.subarray(1))), ['frame-1', 'frame-2'])

  const calls = []
  transport.onFrame(() => calls.push('first'))
  transport.onFrame(() => calls.push('second')) // replaces, per the single-slot contract
  b.send(fragmentFrame(utf8Encode('x'), 0)[0])
  await new Promise((r) => setTimeout(r, 10))
  assert.deepEqual(calls, ['second'])
})

test('DataChannelTransport: close fires onClose once, after queued frames', async () => {
  const [a, b] = FakeDataChannel.pair()
  const transport = new DataChannelTransport(a)
  const order = []
  transport.onFrame(() => order.push('frame'))
  transport.onClose(() => order.push('close'))
  b.send(fragmentFrame(utf8Encode('f1'), 0)[0])
  b.send(fragmentFrame(utf8Encode('f2'), 0)[0])
  transport.close()
  transport.close() // idempotent at the channel level
  await new Promise((r) => setTimeout(r, 10))
  assert.deepEqual(order, ['frame', 'frame', 'close'])
})
