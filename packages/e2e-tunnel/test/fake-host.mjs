// Hand-written host side of tunnel-protocol.md §2/§3, for client tests.
import nacl from 'tweetnacl'
import { b64decode, b64encode, b64urlEncode, concat, utf8Decode, utf8Encode } from '../src/bytes.ts'

const LARGE_SIZE = 300 * 1024
const HOST_CHUNK = 100 * 1024

/**
 * @param {string} relayUrl ws:// base of the fake relay.
 * @param {string} room room id.
 * @param {{ expectedCode?: string }} opts
 * @returns the host handle: pubkey (base64url), seen requests, close().
 */
export async function startFakeHost(relayUrl, room, opts = {}) {
  const keys = nacl.box.keyPair()
  const expectedCode = opts.expectedCode ?? 'test-code'
  const deviceTokens = new Set()
  let tokenCounter = 0
  let pairingClaim = null // { claimant, token }; retries from that key are idempotent

  const ws = new WebSocket(relayUrl + '/r/' + room + '?role=host')
  ws.binaryType = 'arraybuffer'
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })

  const seen = { requests: [], sockets: [], errors: [] }
  let session = null // { clientPub, sendSeq, recvSeq }

  const seal = (obj) => {
    const plain = utf8Encode(JSON.stringify(obj))
    const nonce = nacl.randomBytes(nacl.box.nonceLength)
    return concat(nonce, nacl.box(plain, nonce, session.clientPub, keys.secretKey))
  }
  const sendMsg = (obj) => {
    obj.seq = session.sendSeq
    session.sendSeq += 1
    ws.send(seal(obj))
  }
  const replyError = (code) => {
    ws.send(JSON.stringify({ error: code })) // plaintext frame per §2.2; host stays seated, the rejected client closes
  }

  // Shared hello validation + session adoption for the initial handshake (§2)
  // and the reconnect fallback (unseal failure on an existing session).
  const adoptHello = (clientPub, hello) => {
    let issued = null
    if (typeof hello.code === 'string') {
      if (hello.code !== expectedCode) return replyError('bad-code')
      const claimant = b64urlEncode(clientPub)
      if (pairingClaim !== null) {
        if (pairingClaim.claimant !== claimant) return replyError('bad-code')
        issued = pairingClaim.token
      } else {
        tokenCounter += 1
        issued = 'dev-' + tokenCounter
        pairingClaim = { claimant, token: issued }
        deviceTokens.add(issued)
      }
    } else if (typeof hello.deviceToken === 'string') {
      if (!deviceTokens.has(hello.deviceToken)) return replyError('bad-token')
    } else {
      return replyError('bad-hello')
    }
    session = { clientPub, sendSeq: 0, recvSeq: 0 }
    const ackNonce = nacl.randomBytes(nacl.box.nonceLength)
    const ackJson = issued !== null ? { ok: true, deviceToken: issued } : { ok: true }
    const ack = nacl.box(utf8Encode(JSON.stringify(ackJson)), ackNonce, clientPub, keys.secretKey)
    ws.send(concat(ackNonce, ack))
  }

  ws.addEventListener('message', (ev) => {
    const bytes = new Uint8Array(ev.data)
    if (!session) {
      // §2.1 handshake frame: clientPub(32) || nonce(24) || box(hello)
      const clientPub = bytes.slice(0, 32)
      const nonce = bytes.slice(32, 56)
      const helloBox = nacl.box.open(bytes.slice(56), nonce, clientPub, keys.secretKey)
      if (!helloBox) return replyError('bad-hello')
      return adoptHello(clientPub, JSON.parse(utf8Decode(helloBox)))
    }
    // §3 session frame: nonce(24) || box(json).
    // Reconnect gap (M0 relay never signals peer departure): when unsealing
    // against the current session fails, the frame may be a NEW client's
    // handshake — fall through to handshake parsing before giving up.
    const nonce = bytes.slice(0, 24)
    const plain = nacl.box.open(bytes.slice(24), nonce, session.clientPub, keys.secretKey)
    if (!plain) {
      const clientPub = bytes.slice(0, 32)
      const helloNonce = bytes.slice(32, 56)
      const helloBox = nacl.box.open(bytes.slice(56), helloNonce, clientPub, keys.secretKey)
      if (!helloBox) { ws.close(1008, 'unseal'); return }
      return adoptHello(clientPub, JSON.parse(utf8Decode(helloBox)))
    }
    const msg = JSON.parse(utf8Decode(plain))
    if (typeof msg.seq !== 'number' || msg.seq !== session.recvSeq) { ws.close(1008, 'seq'); return }
    session.recvSeq += 1
    handle(msg)
  })

  const httpBodies = new Map() // id -> { chunks: [], complete: bool }

  function handle(msg) {
    switch (msg.t) {
      case 'ping':
        sendMsg({ t: 'pong', id: msg.id })
        return
      case 'http-req': {
        seen.requests.push({ id: msg.id, method: msg.method, path: msg.path })
        if (msg.body !== undefined) {
          answer(msg, [b64decode(msg.body)])
        } else {
          httpBodies.set(msg.id, { chunks: [], msg })
        }
        return
      }
      case 'http-data': {
        const acc = httpBodies.get(msg.id)
        if (!acc) return
        acc.chunks.push(b64decode(msg.data))
        if (msg.last === true) {
          httpBodies.delete(msg.id)
          answer(acc.msg, acc.chunks)
        }
        return
      }
      case 'ws-open': {
        if (msg.path === '/ws/echo') {
          seen.sockets.push(msg.id)
          sendMsg({ t: 'ws-ack', id: msg.id })
          sendMsg({ t: 'ws-msg', id: msg.id, data: b64encode(utf8Encode('hello-1')) })
          sendMsg({ t: 'ws-msg', id: msg.id, data: b64encode(utf8Encode('hello-2')) })
        } else {
          sendMsg({ t: 'ws-err', id: msg.id, message: 'no such path' })
        }
        return
      }
      case 'ws-msg': {
        const text = utf8Decode(b64decode(msg.data))
        sendMsg({ t: 'ws-msg', id: msg.id, data: b64encode(utf8Encode('echo:' + text)) })
        return
      }
      case 'ws-close': {
        sendMsg({ t: 'ws-close', id: msg.id, code: msg.code ?? 1000, reason: msg.reason ?? '' })
        return
      }
      default:
        return
    }
  }

  function respond(id, status, headers, bodyBytes) {
    if (bodyBytes.length <= HOST_CHUNK) {
      // single frame: body present (even empty) = complete
      sendMsg({ t: 'http-res', id, status, headers, body: b64encode(bodyBytes) })
    } else {
      sendMsg({ t: 'http-res', id, status, headers }) // no body: continuation
      for (let offset = 0; offset < bodyBytes.length; offset += HOST_CHUNK) {
        const slice = bodyBytes.subarray(offset, offset + HOST_CHUNK)
        sendMsg({ t: 'http-data', id, data: b64encode(slice), last: offset + HOST_CHUNK >= bodyBytes.length })
      }
    }
  }

  function answer(req, chunks) {
    const body = concat(...chunks)
    const json = (status, obj) => respond(req.id, status, { 'content-type': 'application/json' }, utf8Encode(JSON.stringify(obj)))
    switch (req.path) {
      case '/api/echo':
        return json(200, { method: req.method, path: req.path, bodyLen: body.length, echo: utf8Decode(body) })
      case '/api/upload': {
        let sum = 0
        for (const b of body) sum = (sum + b) % 100000
        return json(200, { received: body.length, checksum: sum })
      }
      case '/api/large': {
        const big = new Uint8Array(LARGE_SIZE)
        for (let i = 0; i < big.length; i++) big[i] = i % 251
        return respond(req.id, 200, { 'content-type': 'application/octet-stream' }, big)
      }
      case '/api/empty':
        return respond(req.id, 204, {}, new Uint8Array(0))
      case '/api/seqgap':
        session.sendSeq += 1 // deliberate protocol violation for the seq test
        return json(200, { never: 'seen' })
      default:
        return respond(req.id, 404, {}, utf8Encode('not found'))
    }
  }

  return {
    pubkey: b64urlEncode(keys.publicKey),
    seen,
    close: () => ws.close(1000),
  }
}