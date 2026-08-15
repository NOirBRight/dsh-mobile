// Keypair persistence, device token store, one-time offer exchange, QR/fragment format.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import QRCode from 'qrcode'
import { loadOrCreateKeypair } from '../src/keys.ts'
import { DeviceTokenStore } from '../src/tokens.ts'
import { PairingOfferManager, buildOfferUrl, parseOfferUrl } from '../src/pairing.ts'

let dir
before(() => { dir = mkdtempSync(join(tmpdir(), 'dsh-pairing-')) })
after(() => { rmSync(dir, { recursive: true, force: true }) })

test('keypair: created once, reloaded identically, file mode 0600', () => {
  const path = join(dir, 'daemon-keypair.json')
  const a = loadOrCreateKeypair(path)
  const b = loadOrCreateKeypair(path)
  assert.equal(a.publicKeyBase64Url, b.publicKeyBase64Url)
  assert.equal(statSync(path).mode & 0o777, 0o600)
})

test('keypair: corrupt file fails loud instead of silently rotating identity', () => {
  const path = join(dir, 'corrupt.json')
  writeFileSync(path, 'not json')
  assert.throws(() => loadOrCreateKeypair(path), /unreadable keypair/)
  writeFileSync(path, JSON.stringify({ kty: 'OKP', crv: 'Ed25519', x: 'a', d: 'b' }))
  assert.throws(() => loadOrCreateKeypair(path), /not an X25519 JWK/)
})

test('token store: issue, authenticate, persist, revoke', () => {
  const path = join(dir, 'devices.json')
  const store = new DeviceTokenStore(path)
  const { id, token } = store.issue('phone')
  assert.ok(store.authenticate(token))
  assert.equal(store.authenticate('wrong-token'), null)
  assert.equal(statSync(path).mode & 0o777, 0o600)

  // persistence across process-shaped reloads
  const reloaded = new DeviceTokenStore(path)
  assert.equal(reloaded.authenticate(token)?.id, id)

  // list() never exposes token hashes
  const listed = reloaded.list()
  assert.equal(listed.length, 1)
  assert.equal(listed[0].id, id)
  assert.equal('tokenHash' in listed[0], false)

  assert.equal(reloaded.revoke(id), true)
  assert.equal(reloaded.authenticate(token), null)
  assert.equal(reloaded.revoke(id), false) // already revoked
})

test('token store: corrupt store file fails loud', () => {
  const path = join(dir, 'broken-devices.json')
  writeFileSync(path, '{')
  assert.throws(() => new DeviceTokenStore(path), /unreadable device store/)
})

test('offer: mint shape, one-time exchange, expiry', async () => {
  const offers = new PairingOfferManager(50)
  const offer = offers.mint('lan', 'http://192.168.1.5:4000', null, 'pubkey-b64url')
  assert.equal(offer.v, 1)
  assert.equal(offer.mode, 'lan')
  assert.equal(offer.room, null)
  assert.ok(offer.code.length > 20)
  assert.ok(offer.exp > Date.now())

  assert.equal(offers.exchange(offer.code), true)
  assert.equal(offers.exchange(offer.code), false) // burned: one-time

  const stale = offers.mint('lan', 'http://192.168.1.5:4000', null, 'k')
  await new Promise((r) => setTimeout(r, 70))
  assert.equal(offers.exchange(stale.code), false) // expired
  assert.equal(offers.exchange('never-minted'), false)
})

test('offer URL: secret rides the fragment and round-trips', () => {
  const offers = new PairingOfferManager(300_000)
  const offer = offers.mint('lan', 'http://192.168.1.5:4000', null, 'pubkey-b64url')
  const url = buildOfferUrl('https://app.example.com/', offer)
  assert.ok(url.startsWith('https://app.example.com/#offer='))
  assert.ok(!url.split('#')[0].includes('offer')) // nothing secret before the fragment
  assert.deepEqual(parseOfferUrl(url), offer)
  assert.equal(parseOfferUrl('https://app.example.com/'), null)
  assert.equal(parseOfferUrl('https://app.example.com/#offer=@@@'), null)
})

test('QR: SVG and terminal renderings both produce output', async () => {
  const url = buildOfferUrl('https://app.example.com/', new PairingOfferManager(1000).mint('lan', 'http://x:1', null, 'k'))
  const svg = await QRCode.toString(url, { type: 'svg' })
  assert.ok(svg.startsWith('<svg'))
  const terminal = await QRCode.toString(url, { type: 'terminal', small: true })
  assert.ok(terminal.length > 100)
})
