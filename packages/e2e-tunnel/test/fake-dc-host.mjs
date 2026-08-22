// Fake host endpoint over one DataChannel (tunnel-protocol.md §2/§3),
// shared by the DataChannel-adapter and direct-negotiation tests.
import assert from 'node:assert/strict'
import nacl from 'tweetnacl'
import { fragmentFrame, FrameReassembler } from '../src/index.ts'
import { b64encode, concat, utf8Decode, utf8Encode } from '../src/bytes.ts'

// ── Fake host endpoint over one DataChannel ────────────────────────────────
// Speaks tunnel-protocol.md §2/§3 directly (handshake, seal, seq) against a
// FakeDataChannel. Behavior table:
//   code 'test-code'          → ack { ok, deviceToken: 'tok-N' }
//   known deviceToken         → ack { ok }
//   anything else             → plaintext { error: 'bad-code' }
//   http-req '/chunked'       → head without body + two http-data frames
//   http-req '/hang'          → never answered
//   other http-req            → 200 inline body 'body:<METHOD> <path>'
//   ws-open/ws-msg/ws-close   → ack / echo / close reply
export function startFakeDcHost(dc, opts = {}) {
  const keys = nacl.box.keyPair()
  const expectedCode = opts.expectedCode ?? 'test-code'
  // Shareable across host instances so a deviceToken reconnect can pair on a
  // fresh channel against the same store (the real host's token table
  // outlives any one connection).
  const state = opts.state ?? { deviceTokens: new Set(), tokenCounter: 0 }
  let clientPub = null
  let inSeq = 0
  let outSeq = 0

  const seal = (obj) => {
    const plain = utf8Encode(JSON.stringify({ ...obj, seq: outSeq++ }))
    const nonce = nacl.randomBytes(nacl.box.nonceLength)
    return concat(nonce, nacl.box(plain, nonce, clientPub, keys.secretKey))
  }

  // The host side of the DataChannel fragmentation layer (transport.ts wire
  // format): every application message carries the codec header, so frames
  // go out through fragmentFrame and come in through a FrameReassembler.
  let hostFrameId = 0
  const sendFrame = (frame) => {
    for (const message of fragmentFrame(frame, hostFrameId)) dc.send(message)
    if (frame.length > 60 * 1024 - 1) hostFrameId = (hostFrameId + 1) & 0xffff
  }
  const reassembler = new FrameReassembler()

  const normalize = async (data) => {
    if (typeof data === 'string') return data
    if (data instanceof ArrayBuffer) return new Uint8Array(data)
    if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer())
    throw new Error('unexpected payload')
  }

  const handle = (frame) => {
    if (typeof frame === 'string') throw new Error('host: unexpected text frame')
    if (clientPub === null) {
      // Handshake: clientPub(32) || nonce(24) || box(hello)
      clientPub = frame.subarray(0, 32)
      const nonce = frame.subarray(32, 56)
      const opened = nacl.box.open(frame.subarray(56), nonce, clientPub, keys.secretKey)
      assert.ok(opened, 'host could not unseal hello')
      const hello = JSON.parse(utf8Decode(opened))
      let ack
      if (hello.code === expectedCode) {
        const token = 'tok-' + ++state.tokenCounter
        state.deviceTokens.add(token)
        ack = { ok: true, deviceToken: token, hostName: 'Noir Workstation' }
      } else if (typeof hello.deviceToken === 'string' && state.deviceTokens.has(hello.deviceToken)) {
        ack = { ok: true, hostName: 'Noir Workstation' }
      } else {
        sendFrame(utf8Encode(JSON.stringify({ error: 'bad-code' })))
        clientPub = null // stay pre-session, like the real host
        return
      }
      const ackNonce = nacl.randomBytes(nacl.box.nonceLength)
      sendFrame(concat(ackNonce, nacl.box(utf8Encode(JSON.stringify(ack)), ackNonce, clientPub, keys.secretKey)))
      return
    }
    const nonce = frame.subarray(0, nacl.box.nonceLength)
    const opened = nacl.box.open(frame.subarray(nacl.box.nonceLength), nonce, clientPub, keys.secretKey)
    assert.ok(opened, 'host could not unseal session frame')
    const msg = JSON.parse(utf8Decode(opened))
    assert.equal(msg.seq, inSeq++, 'host saw a seq gap')
    switch (msg.t) {
      case 'http-req':
        if (msg.path === '/hang') return
        if (msg.path === '/chunked') {
          sendFrame(seal({ t: 'http-res', id: msg.id, status: 200, headers: {} }))
          sendFrame(seal({ t: 'http-data', id: msg.id, data: b64encode(utf8Encode('chunk-1;')), last: false }))
          sendFrame(seal({ t: 'http-data', id: msg.id, data: b64encode(utf8Encode('chunk-2')), last: true }))
          return
        }
        sendFrame(seal({
          t: 'http-res', id: msg.id, status: 200, headers: { 'x-test': 'yes' },
          body: b64encode(utf8Encode('body:' + msg.method + ' ' + msg.path)),
        }))
        return
      case 'ws-open':
        sendFrame(seal({ t: 'ws-ack', id: msg.id }))
        return
      case 'ws-msg':
        sendFrame(seal({ t: 'ws-msg', id: msg.id, data: msg.data }))
        return
      case 'ws-close':
        sendFrame(seal({ t: 'ws-close', id: msg.id, code: msg.code ?? 1000, reason: msg.reason ?? '' }))
        return
      default:
        throw new Error('host: unknown type ' + msg.t)
    }
  }

  let queue = Promise.resolve()
  dc.addEventListener('message', (ev) => {
    // Sends racing a channel close (e.g. a ws-close reply after the client
    // tore down) are dropped, not fatal to the fake host.
    queue = queue.then(async () => {
      const message = await normalize(ev.data)
      if (typeof message === 'string') return // the host never receives text
      const whole = reassembler.push(message)
      if (whole !== null) handle(whole)
    }).catch(() => {})
  })

  return { pubkey: keys.publicKey }
}
