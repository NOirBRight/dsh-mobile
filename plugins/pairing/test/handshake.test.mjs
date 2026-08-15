// Handshake unit tests (tunnel-protocol.md §2): code/resumeToken redemption,
// error vocabulary, ack crypto. Fully in-process; no network.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import nacl from 'tweetnacl'
import { loadOrCreateKeypair } from '../src/keys.ts'
import { PairingOfferManager } from '../src/pairing.ts'
import { ResumeTokenStore, hostHandshake } from '../src/handshake.ts'

let dir, keypair, offers, resumeTokens, deps
const enc = new TextEncoder()
const dec = new TextDecoder()

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-handshake-'))
  keypair = loadOrCreateKeypair(join(dir, 'kp.json'))
  offers = new PairingOfferManager(60_000)
  resumeTokens = new ResumeTokenStore()
  deps = { keypair, offers, resumeTokens }
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

test('code handshake succeeds; ack opens under the daemon pubkey and carries a fresh resumeToken', () => {
  const offer = offers.mint('relay', 'wss://relay.test', 'a'.repeat(32), keypair.publicKeyBase64Url)
  assert.equal(offer.v, 2) // relay offers are protocol v2
  const { frame, clientKeys } = makeClientFrame({ code: offer.code })
  const ack = openAck(hostHandshake(frame, deps), clientKeys)
  assert.equal(ack.ok, true)
  assert.equal(typeof ack.resumeToken, 'string')
  assert.equal(resumeTokens.redeem(ack.resumeToken), true) // the ack token itself is redeemable once
})

test('unknown code → bad-code; code is single-use', () => {
  const offer = offers.mint('relay', 'wss://relay.test', 'b'.repeat(32), keypair.publicKeyBase64Url)
  const good = makeClientFrame({ code: offer.code })
  assert.equal(hostHandshake(good.frame, deps).ok, true)
  const again = makeClientFrame({ code: offer.code })
  assert.equal(errorOf(hostHandshake(again.frame, deps)), 'bad-code')
  const unknown = makeClientFrame({ code: 'never-minted' })
  assert.equal(errorOf(hostHandshake(unknown.frame, deps)), 'bad-code')
})

test('expired code → expired on first presentation, bad-code after (burned)', async () => {
  const shortOffers = new PairingOfferManager(20)
  const shortDeps = { keypair, offers: shortOffers, resumeTokens }
  const offer = shortOffers.mint('relay', 'wss://relay.test', 'c'.repeat(32), keypair.publicKeyBase64Url)
  await new Promise((r) => setTimeout(r, 40))
  const first = makeClientFrame({ code: offer.code })
  assert.equal(errorOf(hostHandshake(first.frame, shortDeps)), 'expired')
  const second = makeClientFrame({ code: offer.code })
  assert.equal(errorOf(hostHandshake(second.frame, shortDeps)), 'bad-code')
})

test('resumeToken handshake: single-use, rotated in every ack', () => {
  const token = resumeTokens.mint()
  const first = makeClientFrame({ resumeToken: token })
  const ack = openAck(hostHandshake(first.frame, deps), first.clientKeys)
  assert.notEqual(ack.resumeToken, token)
  const reuse = makeClientFrame({ resumeToken: token })
  assert.equal(errorOf(hostHandshake(reuse.frame, deps)), 'bad-resume')
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
