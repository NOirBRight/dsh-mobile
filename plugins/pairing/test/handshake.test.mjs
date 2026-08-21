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
import { DeviceTokenStore, MAX_LIVE_DEVICES } from '../src/tokens.ts'
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
  const { frame, clientKeys } = makeClientFrame({ code: offer.code, label: 'Pixel 9', clientType: 'android' })
  const ack = openAck(hostHandshake(frame, deps), clientKeys)
  assert.equal(ack.ok, true)
  assert.equal(typeof ack.deviceToken, 'string')
  const device = store.authenticate(ack.deviceToken)
  assert.notEqual(device, null)
  assert.equal(device.room, ROOM) // campaign revival binding (protocol §5)
  assert.equal(device.label, 'Pixel 9')
  assert.equal(device.clientType, 'android')
  assert.equal(typeof device.lastSeenAt, 'number')
  assert.equal(store.hasLiveForRoom(ROOM), true)
  assert.deepEqual(store.liveRooms(), [ROOM])
})

test('one-time code is idempotent only for the Client Instance that claimed it', () => {
  const room = 'b'.repeat(32)
  const roomDeps = { ...deps, room }
  const offer = offers.mint('relay', 'wss://relay.test', room, keypair.publicKeyBase64Url)
  const before = store.list().length
  const first = makeClientFrame({ code: offer.code })
  const firstAck = openAck(hostHandshake(first.frame, roomDeps), first.clientKeys)

  // An ack-loss retry from the same client key receives the same token and creates no device.
  const retry = makeClientFrame({ code: offer.code }, first.clientKeys)
  const retryAck = openAck(hostHandshake(retry.frame, roomDeps), retry.clientKeys)
  assert.equal(retryAck.deviceToken, firstAck.deviceToken)
  assert.equal(store.list().length, before + 1)

  // A different client cannot consume the already-claimed offer.
  const otherClient = makeClientFrame({ code: offer.code })
  assert.equal(errorOf(hostHandshake(otherClient.frame, roomDeps)), 'bad-code')
  const unknown = makeClientFrame({ code: 'never-minted' })
  assert.equal(errorOf(hostHandshake(unknown.frame, roomDeps)), 'bad-code')
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

test('deviceToken handshake reconnects only the claiming Client Instance; revoked token → bad-token', () => {
  const first = makeClientFrame({ deviceToken: 'pending' })
  const claimant = Buffer.from(first.clientKeys.publicKey).toString('base64url')
  const originalRoom = 'd'.repeat(32)
  const roomDeps = { ...deps, room: originalRoom }
  const { id, token } = store.issue(undefined, originalRoom, claimant)
  const frame = makeClientFrame({ deviceToken: token }, first.clientKeys)
  const ack = openAck(hostHandshake(frame.frame, roomDeps), first.clientKeys)
  assert.equal(ack.ok, true)
  assert.equal(ack.deviceToken, undefined) // bearer token persists; no rotation in the ack
  assert.equal(store.authenticate(token)?.room, originalRoom)
  const second = makeClientFrame({ deviceToken: token }, first.clientKeys)
  assert.equal(hostHandshake(second.frame, roomDeps).ok, true)
  const stolen = makeClientFrame({ deviceToken: token })
  assert.equal(errorOf(hostHandshake(stolen.frame, roomDeps)), 'bad-token')
  assert.equal(store.authenticate(token)?.room, originalRoom)
  const unknown = makeClientFrame({ deviceToken: 'nope' })
  assert.equal(errorOf(hostHandshake(unknown.frame, roomDeps)), 'bad-token')
  assert.equal(store.revoke(id), true)
  const third = makeClientFrame({ deviceToken: token }, first.clientKeys)
  assert.equal(errorOf(hostHandshake(third.frame, roomDeps)), 'bad-token')
})

test('a code minted for room A cannot pair on room B; a token cannot reconnect on another room', () => {
  const roomA = '1'.repeat(32)
  const roomB = '2'.repeat(32)
  const offer = offers.mintPublic({
    endpoint: 'https://host.example', endpointKind: 'custom', room: roomA, pubkey: keypair.publicKeyBase64Url,
  })
  const first = makeClientFrame({ code: offer.code })
  assert.equal(errorOf(hostHandshake(first.frame, { ...deps, room: roomB })), 'bad-code')
  const paired = makeClientFrame({ code: offer.code }, first.clientKeys)
  const outcome = hostHandshake(paired.frame, { ...deps, room: roomA })
  assert.equal(outcome.ok, true)
  const token = openAck(outcome, first.clientKeys).deviceToken
  assert.equal(errorOf(hostHandshake(makeClientFrame({ deviceToken: token }, first.clientKeys).frame, { ...deps, room: roomB })), 'bad-token')
})

test('a pairing hello at the live-device ceiling returns limit', () => {
  while (store.liveCount() < MAX_LIVE_DEVICES) store.issue('n' + store.liveCount())
  const offer = offers.mint('relay', 'wss://relay.test', ROOM, keypair.publicKeyBase64Url)
  const { frame } = makeClientFrame({ code: offer.code })
  assert.equal(errorOf(hostHandshake(frame, deps)), 'limit')
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
