// Host transport seam tests. The new seam: tunnel-server.ts rides a
// HostFrameTransport (host-transport.ts), so an already-authenticated carrier
// (here: an in-memory frame pair) runs the §3 session mux under a known
// peerPub with NO hello handshake. The relay path keeps its §2 gated
// behavior — covered here as regression through a real WebSocket pair.
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'
import nacl from 'tweetnacl'
import { attachAuthenticatedTransport, attachHandshakeTransport, attachRelaySocket } from '../src/tunnel-server.ts'

const LARGE_BYTES = 200 * 1024 // > BODY_CHUNK_BYTES (96 KiB) so responses chunk

// ── shared helpers ─────────────────────────────────────────────────────────

/** Loopback echo upstream standing in for the dsh web server. */
async function startUpstream() {
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      if (req.url === '/large') {
        res.writeHead(200, { 'content-type': 'application/octet-stream' })
        res.end(Buffer.alloc(LARGE_BYTES, 0x61))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        method: req.method,
        path: req.url,
        host: req.headers.host,
        authorization: req.headers.authorization ?? null,
        'x-custom': req.headers['x-custom'] ?? null,
        body: Buffer.concat(chunks).toString('utf8'),
      }))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { server, port: server.address().port }
}

/** Sealed session message codec for one client keypair against the host key. */
function sessionCodec(clientKeys, hostPub) {
  let inSeq = 0
  let outSeq = 0
  const sealRaw = (obj, seq) => {
    const plain = new TextEncoder().encode(JSON.stringify({ ...obj, seq }))
    const nonce = nacl.randomBytes(nacl.box.nonceLength)
    const boxed = nacl.box(plain, nonce, hostPub, clientKeys.secretKey)
    const frame = new Uint8Array(nacl.box.nonceLength + boxed.length)
    frame.set(nonce, 0)
    frame.set(boxed, nacl.box.nonceLength)
    return frame
  }
  return {
    seal: (obj) => sealRaw(obj, outSeq++),
    sealRaw,
    open(frame) {
      const u8 = frame instanceof Uint8Array ? frame : new Uint8Array(frame)
      const nonce = u8.subarray(0, nacl.box.nonceLength)
      const opened = nacl.box.open(u8.subarray(nacl.box.nonceLength), nonce, hostPub, clientKeys.secretKey)
      assert.ok(opened, 'host frame unseals under the session keys')
      const msg = JSON.parse(new TextDecoder().decode(opened))
      assert.equal(msg.seq, inSeq, 'host outgoing seq is strictly consecutive')
      inSeq++
      return msg
    },
    reset() { inSeq = 0; outSeq = 0 },
  }
}

/** Ordered frame inbox with predicate waiters. */
function createInbox() {
  const items = []
  const waiters = new Set()
  return {
    push(item) {
      items.push(item)
      for (const wake of [...waiters]) wake()
    },
    waitFor(pred, ms = 5000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiters.delete(check)
          reject(new Error('timed out waiting for a tunnel frame'))
        }, ms)
        const check = () => {
          const i = items.findIndex(pred)
          if (i === -1) return
          clearTimeout(timer)
          waiters.delete(check)
          resolve(items.splice(i, 1)[0])
        }
        waiters.add(check)
        check()
      })
    },
  }
}

// ── in-memory transport pair (the new seam, no sockets at all) ─────────────

/** A connected HostFrameTransport pair; close(code) propagates to both ends. */
function transportPair() {
  const make = () => ({
    peer: null,
    frameHandler: null,
    closeHandler: null,
    isClosed: false,
    closeCode: undefined,
    closeReason: undefined,
    send(frame) {
      const peer = this.peer
      queueMicrotask(() => { if (!peer.isClosed) peer.frameHandler?.(frame) })
    },
    onFrame(cb) { this.frameHandler = cb },
    onClose(cb) { this.closeHandler = cb },
    close(code, reason) {
      if (this.isClosed) return
      this.isClosed = true
      this.closeCode = code
      this.closeReason = reason
      queueMicrotask(() => this.closeHandler?.())
      const peer = this.peer
      if (!peer.isClosed) {
        peer.isClosed = true
        peer.closeCode = code
        peer.closeReason = reason
        queueMicrotask(() => peer.closeHandler?.())
      }
    },
  })
  const hostEnd = make()
  const clientEnd = make()
  hostEnd.peer = clientEnd
  clientEnd.peer = hostEnd
  return { hostEnd, clientEnd }
}

/** Attach the host session to the host end; return the client-side session driver. */
function attachInMemory(upstream) {
  const hostKeys = nacl.box.keyPair()
  const clientKeys = nacl.box.keyPair()
  const { hostEnd, clientEnd } = transportPair()
  const closed = new Promise((resolve) => {
    clientEnd.onClose(() => resolve({ code: clientEnd.closeCode, reason: clientEnd.closeReason }))
  })
  let sessionCloseCount = 0
  const gate = attachAuthenticatedTransport(hostEnd, clientKeys.publicKey, {
    upstreamHost: '127.0.0.1',
    upstreamPort: upstream.port,
    hostSecretKey: hostKeys.secretKey,
    onSessionClose: () => { sessionCloseCount++ },
  })
  const codec = sessionCodec(clientKeys, hostKeys.publicKey)
  const inbox = createInbox()
  clientEnd.onFrame((frame) => inbox.push(codec.open(frame)))
  return {
    gate,
    hostEnd,
    clientEnd,
    closed,
    codec,
    inbox,
    sessionCloseCount: () => sessionCloseCount,
  }
}

// ── the new seam ───────────────────────────────────────────────────────────

test('a sealed HTTP GET flows through an authenticated in-memory transport (no handshake)', async (t) => {
  const upstream = await startUpstream()
  t.after(() => upstream.server.close())
  const { gate, codec, inbox, clientEnd } = attachInMemory(upstream)
  t.after(() => gate.close())

  // The very first frame is already a session frame: no hello ever ran.
  clientEnd.send(codec.seal({
    t: 'http-req',
    id: 'r1',
    method: 'GET',
    path: '/api/ping',
    headers: { authorization: 'Bearer must-not-cross', 'x-custom': 'kept' },
  }))
  const res = await inbox.waitFor((m) => m.t === 'http-res' && m.id === 'r1')
  assert.equal(res.status, 200)
  const echo = JSON.parse(Buffer.from(res.body, 'base64').toString('utf8'))
  assert.equal(echo.method, 'GET')
  assert.equal(echo.path, '/api/ping')
  assert.equal(echo.host, '127.0.0.1:' + upstream.port, 'Host rewritten to the loopback authority')
  assert.equal(echo.authorization, null, 'credential headers never cross onto the loopback request')
  assert.equal(echo['x-custom'], 'kept')
})

test('authenticated sessions cannot reach Host pairing administration paths', async (t) => {
  const hits = []
  const server = http.createServer((req, res) => {
    hits.push(req.url)
    res.writeHead(200)
    res.end('should-not-see')
  })
  t.after(() => server.close())
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { gate, codec, inbox, clientEnd } = attachInMemory({ port: server.address().port })
  t.after(() => gate.close())

  for (const path of ['/pair', '/pair/revoke', '/pair/ui', '/pair?format=svg', '/api/../pair']) {
    clientEnd.send(codec.seal({ t: 'http-req', id: path, method: path === '/pair/revoke' ? 'POST' : 'GET', path, headers: {} }))
    const res = await inbox.waitFor((m) => m.t === 'http-res' && m.id === path)
    assert.equal(res.status, 404, path)
  }
  assert.deepEqual(hits, [])
})

test('http-req paths that are not origin-relative close the session', async (t) => {
  const upstream = await startUpstream()
  t.after(() => upstream.server.close())
  const { gate, codec, clientEnd, closed } = attachInMemory(upstream)
  t.after(() => gate.close())

  clientEnd.send(codec.seal({
    t: 'http-req',
    id: 'escape',
    method: 'GET',
    path: 'http://127.0.0.1/pair',
    headers: {},
  }))
  const close = await closed
  assert.equal(close.code, 4400)
})

test('an encrypted heartbeat ping receives a correlated pong through the transport seam', async (t) => {
  const upstream = await startUpstream()
  t.after(() => upstream.server.close())
  const { gate, codec, inbox, clientEnd } = attachInMemory(upstream)
  t.after(() => gate.close())

  clientEnd.send(codec.seal({ t: 'ping', id: 'heartbeat-1' }))
  const pong = await inbox.waitFor((message) => message.t === 'pong')
  assert.equal(pong.id, 'heartbeat-1')
})

test('a streamed POST body reassembles across http-data frames through the seam', async (t) => {
  const upstream = await startUpstream()
  t.after(() => upstream.server.close())
  const { gate, codec, inbox, clientEnd } = attachInMemory(upstream)
  t.after(() => gate.close())

  clientEnd.send(codec.seal({ t: 'http-req', id: 'r2', method: 'POST', path: '/api/upload', headers: {} }))
  clientEnd.send(codec.seal({ t: 'http-data', id: 'r2', data: Buffer.from('hello ').toString('base64') }))
  clientEnd.send(codec.seal({ t: 'http-data', id: 'r2', data: Buffer.from('tunnel').toString('base64'), last: true }))
  const res = await inbox.waitFor((m) => m.t === 'http-res' && m.id === 'r2')
  assert.equal(res.status, 200)
  const echo = JSON.parse(Buffer.from(res.body, 'base64').toString('utf8'))
  assert.equal(echo.method, 'POST')
  assert.equal(echo.body, 'hello tunnel')
})

test('a large upstream response chunks into http-data frames through the seam', async (t) => {
  const upstream = await startUpstream()
  t.after(() => upstream.server.close())
  const { gate, codec, inbox, clientEnd } = attachInMemory(upstream)
  t.after(() => gate.close())

  clientEnd.send(codec.seal({ t: 'http-req', id: 'r3', method: 'GET', path: '/large', headers: {} }))
  const head = await inbox.waitFor((m) => m.t === 'http-res' && m.id === 'r3')
  assert.equal(head.status, 200)
  assert.equal(head.body, undefined, 'oversized responses start with a bodyless http-res')
  const parts = []
  let last = false
  while (!last) {
    const chunk = await inbox.waitFor((m) => m.t === 'http-data' && m.id === 'r3')
    parts.push(Buffer.from(chunk.data, 'base64'))
    last = chunk.last === true
  }
  const body = Buffer.concat(parts)
  assert.equal(body.length, LARGE_BYTES)
  assert.ok(body.equals(Buffer.alloc(LARGE_BYTES, 0x61)))
})

test('an unsealable frame on an authenticated transport closes 4400 (no handshake fallback)', async (t) => {
  const upstream = await startUpstream()
  t.after(() => upstream.server.close())
  const { gate, clientEnd, closed } = attachInMemory(upstream)
  t.after(() => gate.close())

  clientEnd.send(nacl.randomBytes(64)) // well-formed length, sealed under no known key
  const close = await closed
  assert.equal(close.code, 4400)
})

test('a seq violation on an authenticated transport closes 4401', async (t) => {
  const upstream = await startUpstream()
  t.after(() => upstream.server.close())
  const { gate, codec, clientEnd, closed } = attachInMemory(upstream)
  t.after(() => gate.close())

  clientEnd.send(codec.sealRaw({ t: 'http-req', id: 'r4', method: 'GET', path: '/api/ping', headers: {} }, 7))
  const close = await closed
  assert.equal(close.code, 4401)
})

test('gate close and peer close both settle the session exactly once', async (t) => {
  const upstream = await startUpstream()
  t.after(() => upstream.server.close())

  const first = attachInMemory(upstream)
  first.gate.close()
  first.gate.close() // idempotent
  await first.closed
  assert.equal(first.sessionCloseCount(), 1)

  const second = attachInMemory(upstream)
  t.after(() => second.gate.close())
  second.clientEnd.close() // carrier-initiated close (DataChannel drop)
  await second.closed // both close handlers are queued before this resumes
  assert.equal(second.sessionCloseCount(), 1)
})

// ── relay adapter regression (attachRelaySocket behavior preserved) ────────

/** §2 hello frame: clientPub(32) || nonce(24) || box(helloJson, hostPub, clientSec). */
function helloFrame(clientKeys, hostPub, hello) {
  const plain = new TextEncoder().encode(JSON.stringify(hello))
  const nonce = nacl.randomBytes(nacl.box.nonceLength)
  const boxed = nacl.box(plain, nonce, hostPub, clientKeys.secretKey)
  const frame = new Uint8Array(56 + boxed.length)
  frame.set(clientKeys.publicKey, 0)
  frame.set(nonce, 32)
  frame.set(boxed, 56)
  return frame
}

function openSealed(frameBuf, clientKeys, hostPub) {
  const u8 = new Uint8Array(frameBuf)
  const nonce = u8.subarray(0, nacl.box.nonceLength)
  const opened = nacl.box.open(u8.subarray(nacl.box.nonceLength), nonce, hostPub, clientKeys.secretKey)
  assert.ok(opened, 'frame unseals')
  return JSON.parse(new TextDecoder().decode(opened))
}

function fakeHandshakeDeps(hostKeys) {
  return {
    keypair: { secretKeyRaw: hostKeys.secretKey, publicKeyRaw: hostKeys.publicKey },
    offers: { claim: (code, _claimant, issue) => code === 'good-code' ? { status: 'ok', deviceToken: issue() } : { status: 'unknown' } },
    devices: {
      issue: () => ({ token: 'device-token-1' }),
      authenticate: (token) => (token === 'device-token-1' ? { id: 'dev-1' } : null),
      bindRoom: () => {},
    },
  }
}


test('a generic frame transport runs the NaCl hello before session traffic', async (t) => {
  const upstream = await startUpstream()
  t.after(() => upstream.server.close())
  const hostKeys = nacl.box.keyPair()
  const clientKeys = nacl.box.keyPair()
  const { hostEnd, clientEnd } = transportPair()
  const inbox = createInbox()
  clientEnd.onFrame(frame => inbox.push(frame))
  const gate = attachHandshakeTransport(hostEnd, {
    upstreamHost: '127.0.0.1',
    upstreamPort: upstream.port,
    handshake: fakeHandshakeDeps(hostKeys),
  })
  t.after(() => gate.close())
  clientEnd.send(helloFrame(clientKeys, hostKeys.publicKey, { code: 'good-code' }))
  const ack = await inbox.waitFor(frame => {
    try { return openSealed(frame, clientKeys, hostKeys.publicKey).ok === true } catch { return false }
  })
  assert.equal(openSealed(ack, clientKeys, hostKeys.publicKey).deviceToken, 'device-token-1')
})

/** Real ws pair with attachRelaySocket on the server end and a frame inbox on the client end. */
async function relayPair(upstream, t) {
  const hostKeys = nacl.box.keyPair()
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  t.after(() => wss.close())
  await new Promise((resolve) => wss.on('listening', resolve))
  const client = new WebSocket('ws://127.0.0.1:' + wss.address().port)
  const serverSocket = await new Promise((resolve) => wss.on('connection', resolve))
  await new Promise((resolve, reject) => {
    client.on('open', resolve)
    client.on('error', reject)
  })
  const gate = attachRelaySocket(serverSocket, {
    upstreamHost: '127.0.0.1',
    upstreamPort: upstream.port,
    handshake: fakeHandshakeDeps(hostKeys),
  })
  t.after(() => gate.close())
  const inbox = createInbox()
  client.on('message', (data, isBinary) => inbox.push({ data: Buffer.from(data), isBinary }))
  const closed = new Promise((resolve) => client.on('close', (code) => resolve(code)))
  return { hostKeys, client, inbox, closed }
}

test('relay socket still gates on the §2 handshake, then runs the session', async (t) => {
  const upstream = await startUpstream()
  t.after(() => upstream.server.close())
  const { hostKeys, client, inbox } = await relayPair(upstream, t)
  const clientKeys = nacl.box.keyPair()

  // A bad hello is rejected in place (plaintext error frame, host stays seated)…
  client.send(helloFrame(clientKeys, hostKeys.publicKey, { code: 'wrong-code' }))
  const errFrame = await inbox.waitFor((f) => {
    try { return JSON.parse(f.data.toString('utf8')).error === 'bad-code' } catch { return false }
  })
  assert.equal(JSON.parse(errFrame.data.toString('utf8')).error, 'bad-code')

  // …and a good hello on the same socket still pairs and opens the session.
  client.send(helloFrame(clientKeys, hostKeys.publicKey, { code: 'good-code' }))
  const ackFrame = await inbox.waitFor((f) => {
    try { return openSealed(f.data, clientKeys, hostKeys.publicKey).ok === true } catch { return false }
  })
  assert.equal(openSealed(ackFrame.data, clientKeys, hostKeys.publicKey).deviceToken, 'device-token-1')

  const codec = sessionCodec(clientKeys, hostKeys.publicKey)
  client.send(codec.seal({ t: 'http-req', id: 'g1', method: 'GET', path: '/api/ping', headers: {} }))
  let res
  await inbox.waitFor((f) => {
    try { res = codec.open(f.data); return res.id === 'g1' } catch { return false }
  })
  assert.equal(res.status, 200)
  assert.equal(JSON.parse(Buffer.from(res.body, 'base64').toString('utf8')).path, '/api/ping')
})

test('a mid-socket re-handshake on the relay socket replaces the session and resets seq', async (t) => {
  const upstream = await startUpstream()
  t.after(() => upstream.server.close())
  const { hostKeys, client, inbox } = await relayPair(upstream, t)
  const clientKeysA = nacl.box.keyPair()

  client.send(helloFrame(clientKeysA, hostKeys.publicKey, { code: 'good-code' }))
  await inbox.waitFor((f) => {
    try { return openSealed(f.data, clientKeysA, hostKeys.publicKey).ok === true } catch { return false }
  })

  // A roaming client re-joins with a fresh ephemeral key: the frame cannot
  // unseal under session A, so the host retries it as a handshake.
  const clientKeysB = nacl.box.keyPair()
  client.send(helloFrame(clientKeysB, hostKeys.publicKey, { deviceToken: 'device-token-1' }))
  const ackFrame = await inbox.waitFor((f) => {
    try { return openSealed(f.data, clientKeysB, hostKeys.publicKey).ok === true } catch { return false }
  })
  assert.deepEqual(openSealed(ackFrame.data, clientKeysB, hostKeys.publicKey), { ok: true })

  // Both seq domains reset: the new session starts at 0 again.
  const codecB = sessionCodec(clientKeysB, hostKeys.publicKey)
  client.send(codecB.seal({ t: 'http-req', id: 'g2', method: 'GET', path: '/api/ping', headers: {} }))
  let res
  await inbox.waitFor((f) => {
    try { res = codecB.open(f.data); return res.id === 'g2' } catch { return false }
  })
  assert.equal(res.status, 200)
})

test('a text frame on the relay socket closes 4400', async (t) => {
  const upstream = await startUpstream()
  t.after(() => upstream.server.close())
  const { client, closed } = await relayPair(upstream, t)
  client.send('not a binary frame')
  assert.equal(await closed, 4400)
})
