// Fragmentation-layer tests: the DataChannelTransport must keep every
// RTCDataChannel application message ≤ 60 KiB while FrameTransport callers
// only ever see whole frames — including multi-megabyte ones — and must
// close on any malformed fragment stream.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import nacl from 'tweetnacl'
import { DataChannelTransport, WsFrameTransport, fragmentFrame, FrameReassembler, MAX_MESSAGE_BYTES, MAX_RELAY_MESSAGE_BYTES, MAX_FRAME_BYTES, TunnelError } from '../src/index.ts'
import { FakeDataChannel } from './fake-datachannel.mjs'

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

/** Deterministic multi-megabyte pattern (not round-sized, on purpose). */
const pattern = (n) => {
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) out[i] = (i * 31 + (i >> 8)) & 0xff
  return out
}

/** Two DataChannelTransports over an in-memory pair; frames[] collects what tb delivers. */
function openPair() {
  const [a, b] = FakeDataChannel.pair()
  const ta = new DataChannelTransport(a)
  const tb = new DataChannelTransport(b)
  const frames = []
  const closes = []
  tb.onFrame((f) => frames.push(f))
  tb.onClose(() => closes.push(true))
  return { a, b, ta, tb, frames, closes }
}

async function waitFor(cond, timeoutMs = 2000) {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 1))
  }
}

/** Hand-craft a fragment message (malformed on demand). */
function frag(id, offset, total, payloadLen) {
  const m = new Uint8Array(11 + payloadLen)
  const v = new DataView(m.buffer)
  m[0] = 0x01
  v.setUint16(1, id, true)
  v.setUint32(3, offset, true)
  v.setUint32(7, total, true)
  for (let i = 11; i < m.length; i++) m[i] = i & 0xff
  return m
}

// ── Codec units ─────────────────────────────────────────────────────────────

test('fragmentFrame: frames up to 61439 B ride one whole message', () => {
  const frame = pattern(MAX_MESSAGE_BYTES - 1)
  const messages = fragmentFrame(frame, 0)
  assert.equal(messages.length, 1)
  assert.equal(messages[0].length, MAX_MESSAGE_BYTES)
  assert.equal(messages[0][0], 0x00)
  assert.deepEqual(messages[0].subarray(1), frame)
})

test('fragmentFrame: a 61440 B frame fragments; every message ≤ 60 KiB', () => {
  const frame = pattern(MAX_MESSAGE_BYTES)
  const messages = fragmentFrame(frame, 7)
  assert.equal(messages.length, 2)
  for (const m of messages) assert.ok(m.length <= MAX_MESSAGE_BYTES, 'wire message over 60 KiB')
  const reassembler = new FrameReassembler()
  assert.equal(reassembler.push(messages[0]), null)
  assert.deepEqual(reassembler.push(messages[1]), frame)
})

test('FrameReassembler: exact multiple of the fragment payload', () => {
  const frame = pattern((MAX_MESSAGE_BYTES - 11) * 3)
  const messages = fragmentFrame(frame, 0)
  assert.equal(messages.length, 3)
  const reassembler = new FrameReassembler()
  let whole = null
  for (const m of messages) whole = reassembler.push(m) ?? whole
  assert.deepEqual(whole, frame)
})

// ── Transparent fragmentation behind FrameTransport ────────────────────────

test('a multi-megabyte frame crosses the transport byte-exact, all wire messages ≤ 60 KiB', async () => {
  const { a, ta, frames, closes } = openPair()
  a.wireSizes = []
  const big = pattern(3 * 1024 * 1024 + 123) // ~3 MiB
  ta.send(big)
  await waitFor(() => frames.length === 1)
  const expectedMessages = Math.ceil(big.length / (MAX_MESSAGE_BYTES - 11))
  assert.equal(a.wireSizes.length, expectedMessages)
  for (const size of a.wireSizes) assert.ok(size <= MAX_MESSAGE_BYTES, 'wire message over 60 KiB: ' + size)
  assert.equal(frames[0].length, big.length)
  assert.equal(sha256(frames[0]), sha256(big))
  assert.equal(closes.length, 0)
})

test('a multi-megabyte ENCRYPTED (NaCl-sealed) frame crosses byte-exact and unseals', async () => {
  const { a, ta, frames, closes } = openPair()
  a.wireSizes = []
  // Seal ~3 MiB exactly as the session layer does: nonce(24) || box(plain).
  const keys = nacl.box.keyPair()
  const plain = pattern(3 * 1024 * 1024 + 77)
  const nonce = nacl.randomBytes(nacl.box.nonceLength)
  const sealed = new Uint8Array(nacl.box.nonceLength + plain.length + nacl.box.overheadLength)
  sealed.set(nonce, 0)
  sealed.set(nacl.box(plain, nonce, keys.publicKey, keys.secretKey), nacl.box.nonceLength)
  ta.send(sealed)
  await waitFor(() => frames.length === 1)
  for (const size of a.wireSizes) assert.ok(size <= MAX_MESSAGE_BYTES, 'wire message over 60 KiB: ' + size)
  assert.equal(frames[0].length, sealed.length)
  assert.equal(sha256(frames[0]), sha256(sealed))
  // And it is a genuinely sealed frame: it unseals back to the plaintext.
  const opened = nacl.box.open(frames[0].subarray(nacl.box.nonceLength), frames[0].subarray(0, nacl.box.nonceLength), keys.publicKey, keys.secretKey)
  assert.ok(opened !== null, 'reassembled frame failed to unseal')
  assert.equal(sha256(opened), sha256(plain))
  assert.equal(closes.length, 0)
})

test('fragmented frames and whole frames interleave without reordering', async () => {
  const { ta, frames } = openPair()
  const big1 = pattern(200 * 1024)
  const small = pattern(100)
  const big2 = pattern(150 * 1024 + 7)
  ta.send(big1)
  ta.send(small)
  ta.send(big2)
  await waitFor(() => frames.length === 3)
  assert.equal(sha256(frames[0]), sha256(big1))
  assert.deepEqual(frames[1], small)
  assert.equal(sha256(frames[2]), sha256(big2))
})

test('relay WebSocket transport fragments a multi-megabyte sealed frame below the Relay cap', async () => {
  const [a, b] = FakeDataChannel.pair()
  const sender = new WsFrameTransport(a)
  const receiver = new WsFrameTransport(b)
  const frames = []
  a.wireSizes = []
  receiver.onFrame(frame => frames.push(frame))
  const big = pattern(2 * 1024 * 1024 - 123)

  sender.send(big)
  await waitFor(() => frames.length === 1)

  assert.ok(a.wireSizes.length > 1)
  for (const size of a.wireSizes) assert.ok(size <= MAX_RELAY_MESSAGE_BYTES, 'Relay message over limit: ' + size)
  assert.equal(sha256(frames[0]), sha256(big))
})

test('relay WebSocket transport leaves small sealed frames raw for rolling compatibility', async () => {
  const [a, b] = FakeDataChannel.pair()
  const sender = new WsFrameTransport(a)
  const receiver = new WsFrameTransport(b)
  const frames = []
  a.wireSizes = []
  receiver.onFrame(frame => frames.push(frame))
  const small = pattern(1024)

  sender.send(small)
  await waitFor(() => frames.length === 1)

  assert.deepEqual(a.wireSizes, [small.length])
  assert.deepEqual(frames[0], small)
})

test('fragments delivered as Blobs reassemble in order', async () => {
  const { b, ta, frames } = openPair()
  b.blobMode = true // every wire message arrives at tb as a Blob
  const big = pattern(1024 * 1024 + 1)
  ta.send(big)
  await waitFor(() => frames.length === 1)
  assert.equal(sha256(frames[0]), sha256(big))
})

// ── Strict validation: a malformed fragment stream closes the transport ────

test('a fragment stream not starting at offset 0 closes the transport', async () => {
  const { a, closes } = openPair()
  a.send(frag(0, 500, 1000, 500)) // first fragment claims offset 500
  await waitFor(() => closes.length === 1)
  assert.equal(a.closed, true)
})

test('a second frame fragmenting mid-reassembly closes the transport', async () => {
  const { a, frames, closes } = openPair()
  a.send(frag(0, 0, 1000, 400)) // frame 0 starts, incomplete
  a.send(frag(1, 0, 100, 100))   // different id while frame 0 is in flight
  await waitFor(() => closes.length === 1)
  assert.equal(frames.length, 0) // nothing half-assembled was delivered
})

test('a fragment gap (offset ≠ received) closes the transport', async () => {
  const { a, closes } = openPair()
  a.send(frag(0, 0, 1000, 400))
  a.send(frag(0, 500, 1000, 500)) // skips bytes 400..499
  await waitFor(() => closes.length === 1)
})

test('a total over the frame cap closes the transport', async () => {
  const { a, closes } = openPair()
  a.send(frag(0, 0, MAX_FRAME_BYTES + 1, 100))
  await waitFor(() => closes.length === 1)
})

test('a fragment overrunning its declared total closes the transport', async () => {
  const { a, closes } = openPair()
  a.send(frag(0, 0, 300, 400)) // 0 + 400 > 300
  await waitFor(() => closes.length === 1)
})

test('a wire message over 60 KiB closes the transport', async () => {
  const { a, closes } = openPair()
  const oversized = new Uint8Array(MAX_MESSAGE_BYTES + 1)
  oversized[0] = 0x00
  a.send(oversized)
  await waitFor(() => closes.length === 1)
})

test('FrameReassembler stays broken after a violation', () => {
  const reassembler = new FrameReassembler()
  assert.throws(() => reassembler.push(frag(0, 10, 100, 10)), (e) => e instanceof TunnelError && e.code === 'bad-fragment')
  assert.throws(() => reassembler.push(frag(0, 0, 100, 10)), (e) => e.code === 'bad-fragment')
})
