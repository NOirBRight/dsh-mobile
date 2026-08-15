// Handshake unit tests (tunnel-protocol.md §2): code/deviceToken redemption,
// error vocabulary, ack crypto. Fully in-process; no network.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import nacl from 'tweetnacl'
import { loadOrCreateKeypair } from '../src/keys.ts'
import { PairingOfferManager } from '../src/pairing.ts'
import { DeviceTokenStore } from '../src/tokens.ts'
import { hostHandshake } from '../src/handshake.ts'

let dir, keypair, offers, store, deps
const enc = new TextEncoder()
const dec = new TextDecoder()
const ROOM = 'a'.repeat(32)

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-handshake-'))
  keypair = loadOrCreateKeypair(join(dir, 'kp.json'))
  offers = new PairingOfferManager(60_000)
  store = new DeviceTokenStore(join(dir, 'devices.json'))
  deps = { keypair, offers, devices: store, room: ROOM }
})
after(() => rmSync(dir, { recursive: true, force: true }))

/** Build a client handshake frame carrying hello, sealed to the daemon pubkey. */
function makeClientFrame(hello, clientKeys = nacl.box.keyPair()) {
  const nonce = nacl.randomBytes(24)
  const sealed = nacl.box(enc.encode(JSON.stringify(hello)), nonce, keypair.publicKeyRaw, clientKeys.secretKey)
  const frame = new Uint8Array(56 + sealed.length)
  frame.set(clientKeys.publicKey, 0)
  frame.set(nonce, 32)
  frame.set(sealed, 56)
  return { frame, clientKeys }
}

function openAck(outcome, clientKeys) {
  assert.equal(outcome.ok, true)
  const nonce = outcome.ackFrame.subarray(0, 24)
  const opened = nacl.box.open(outcome.ackFrame.subarray(24), nonce, keypair.publicKeyRaw, clientKeys.secretKey)
  assert.notEqual(opened, null)
  return JSON.parse(dec.decode(opened))
}

function errorOf(outcome) {
  assert.equal(outcome.ok, false)
  return JSON.parse(dec.decode(outcome.errorFrame)).error
}

test('code handshake pairs a new device: ack carries a device token bound to the room', () => {
  const offer = offers.mint('relay', 'wss://relay.test', ROOM, keypair.publicKeyBase64Url)
  assert.equal(offer.v, 2) // relay offers are protocol v2
  const { frame, clientKeys } = makeClientFrame({ code: offer.code })
  const ack = openAck(hostHandshake(frame, deps), clientKeys)
  assert.equal(ack.ok, true)
  assert.equal(typeof ack.deviceToken, 'string')
  const device = store.authenticate(ack.deviceToken)
  assert.notEqual(device, null)
  assert.equal(device.room, ROOM) // campaign revival binding (protocol §5)
  assert.equal(store.hasLiveForRoom(ROOM), true)
  assert.deepEqual(store.liveRooms(), [ROOM])
})

test('unknown code → bad-code; code is multi-use within its window (ack-loss safe)', () => {
  const offer = offers.mint('relay', 'wss://relay.test', 'b'.repeat(32), keypair.publicKeyBase64Url)
  const good = makeClientFrame({ code: offer.code })
  assert.equal(hostHandshake(good.frame, deps).ok, true)
  // same code again inside the window: pairs ANOTHER device (a lost ack must not brick the phone)
  const again = makeClientFrame({ code: offer.code })
  assert.equal(hostHandshake(again.frame, deps).ok, true)
  const unknown = makeClientFrame({ code: 'never-minted' })
  assert.equal(errorOf(hostHandshake(unknown.frame, deps)), 'bad-code')
})

test('expired code → expired on every presentation (validate never burns)', async () => {
  const shortOffers = new PairingOfferManager(20)
  const shortDeps = { keypair, offers: shortOffers, devices: store, room: 'c'.repeat(32) }
  const offer = shortOffers.mint('relay', 'wss://relay.test', 'c'.repeat(32), keypair.publicKeyBase64Url)
  await new Promise((r) => setTimeout(r, 40))
  const first = makeClientFrame({ code: offer.code })
  assert.equal(errorOf(hostHandshake(first.frame, shortDeps)), 'expired')
  const second = makeClientFrame({ code: offer.code })
  assert.equal(errorOf(hostHandshake(second.frame, shortDeps)), 'expired')
})

test('deviceToken handshake reconnects forever and re-binds the room; revoked token → bad-token', () => {
  const { id, token } = store.issue(undefined, 'd'.repeat(32))
  const first = makeClientFrame({ deviceToken: token })
  const ack = openAck(hostHandshake(first.frame, deps), first.clientKeys)
  assert.equal(ack.ok, true)
  assert.equal(ack.deviceToken, undefined) // bearer token persists; no rotation in the ack
  // the handshake landed on deps.room: the device re-binds to it (keeps the new room's campaign alive)
  assert.equal(store.authenticate(token)?.room, ROOM)
  // same token again — still valid (permanent until revoked)
  const second = makeClientFrame({ deviceToken: token })
  assert.equal(hostHandshake(second.frame, deps).ok, true)
  // unknown token
  const unknown = makeClientFrame({ deviceToken: 'nope' })
  assert.equal(errorOf(hostHandshake(unknown.frame, deps)), 'bad-token')
  // revoked
  assert.equal(store.revoke(id), true)
  const third = makeClientFrame({ deviceToken: token })
  assert.equal(errorOf(hostHandshake(third.frame, deps)), 'bad-token')
})

test('hello without credentials → bad-hello; garbage frame → bad-hello; frame sealed to a wrong host key → bad-hello', () => {
  const noCreds = makeClientFrame({})
  assert.equal(errorOf(hostHandshake(noCreds.frame, deps)), 'bad-hello')
  assert.equal(errorOf(hostHandshake(nacl.randomBytes(80), deps)), 'bad-hello')

  const wrongHost = nacl.box.keyPair()
  const clientKeys = nacl.box.keyPair()
  const nonce = nacl.randomBytes(24)
  const sealed = nacl.box(enc.encode(JSON.stringify({ code: 'x' })), nonce, wrongHost.publicKey, clientKeys.secretKey)
  const frame = new Uint8Array(56 + sealed.length)
  frame.set(clientKeys.publicKey, 0)
  frame.set(nonce, 32)
  frame.set(sealed, 56)
  assert.equal(errorOf(hostHandshake(frame, deps)), 'bad-hello')
})
