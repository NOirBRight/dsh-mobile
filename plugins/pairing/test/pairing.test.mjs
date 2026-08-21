// Keypair persistence, device token store, one-time offer exchange, QR/fragment format.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import QRCode from 'qrcode'
import { loadOrCreateKeypair } from '../src/keys.ts'
import { DeviceLimitError, DeviceTokenStore, MAX_LIVE_DEVICES } from '../src/tokens.ts'
import { PairingOfferManager, buildCompactPublicOfferUrl, buildOfferUrl, parseOfferUrl } from '../src/pairing.ts'

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

test('token store can rename a live device and rejects revoked ones', () => {
  const store = new DeviceTokenStore(join(dir, 'rename-devices.json'))
  const { id } = store.issue('old-name')
  assert.equal(store.rename(id, '  书房手机  '), true)
  assert.equal(store.list()[0].label, '书房手机')
  assert.equal(store.rename(id, '   '), true)
  assert.equal(store.list()[0].label, undefined)
  assert.equal(store.revoke(id), true)
  assert.equal(store.rename(id, 'gone'), false)
})

test('token store binds a token to one Client Instance public key', () => {
  const store = new DeviceTokenStore(join(dir, 'bound-devices.json'))
  const owner = 'A'.repeat(43)
  const other = 'B'.repeat(43)
  const { token } = store.issue('phone', 'a'.repeat(32), owner)
  assert.equal(store.authenticate(token, owner)?.room, 'a'.repeat(32))
  assert.equal(store.authenticate(token, other), null)
  assert.equal(store.authenticate(token)?.room, 'a'.repeat(32))
})

test('token store records client type, last-seen, and a defensive live limit', () => {
  const store = new DeviceTokenStore(join(dir, 'meta-devices.json'))
  const { token } = store.issue('Pixel', 'a'.repeat(32), 'A'.repeat(43), 'android')
  const first = store.authenticate(token, 'A'.repeat(43))
  assert.equal(first.clientType, 'android')
  assert.equal(first.label, 'Pixel')
  assert.equal(typeof first.lastSeenAt, 'number')
  const later = store.authenticate(token, 'A'.repeat(43))
  assert.ok(later.lastSeenAt >= first.lastSeenAt)
  for (let i = store.liveCount(); i < MAX_LIVE_DEVICES; i++) store.issue('n' + i)
  assert.equal(store.liveCount(), MAX_LIVE_DEVICES)
  assert.throws(() => store.issue('overflow'), error => error instanceof DeviceLimitError)
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
  assert.ok(offer.exp >= Math.floor(Date.now() / 1000)) // wire exp is unix seconds (tunnel-protocol.md §1)

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


test('public endpoint offer carries Host-owned rendezvous and fallback capabilities', () => {
  const offers = new PairingOfferManager(300_000)
  const offer = offers.mintPublic({
    endpoint: 'https://host.example', endpointKind: 'temporary', room: 'b'.repeat(32), pubkey: 'A'.repeat(43),
    ice: ['stun:stun.example.com:3478'],
  })
  assert.equal(offer.v, 4)
  assert.equal(offer.mode, 'public')
  assert.equal(offer.protocol, 1)
  assert.equal(offer.endpoint, 'https://host.example')
  assert.equal(offer.endpointKind, 'temporary')
  assert.deepEqual(offer.capabilities, { browser: false, direct: true, tunnel: true, endpointRefresh: true })
  const forced = new PairingOfferManager(300_000).mintPublic({
    endpoint: 'https://host.example', endpointKind: 'custom', room: 'd'.repeat(32), pubkey: 'A'.repeat(43),
    capabilities: { browser: true, direct: true, tunnel: true, endpointRefresh: true },
  })
  assert.equal(forced.capabilities.browser, false)
  assert.deepEqual(offer.ice, ['stun:stun.example.com:3478'])
  assert.equal(offers.exchange(offer.code), true)
  assert.equal(offers.exchange(offer.code), false)
  assert.deepEqual(parseOfferUrl(buildOfferUrl('dsh-mobile://pair', offer)), offer)
})

test('compact public QR stays shorter than the previously working v3 scanner payload', () => {
  const offer = new PairingOfferManager(300_000).mintPublic({
    endpoint: 'https://warren-cayman-born-categories.trycloudflare.com', endpointKind: 'temporary',
    room: 'c'.repeat(32), pubkey: 'A'.repeat(43), ice: ['stun:stun.cloudflare.com:3478'],
  })
  const url = buildCompactPublicOfferUrl('dsh-mobile://pair', offer)
  assert.ok(url.length < 377, 'compact QR grew to ' + url.length + ' characters')
  const payload = JSON.parse(Buffer.from(url.split('#offer=')[1], 'base64url').toString())
  assert.equal(payload[0], 4)
  assert.equal(payload[7], 14)
})

test('public endpoint offers reject insecure endpoints and TURN', () => {
  const offers = new PairingOfferManager(300_000)
  const base = { endpointKind: 'custom', room: 'c'.repeat(32), pubkey: 'A'.repeat(43) }
  assert.throws(() => offers.mintPublic({ ...base, endpoint: 'http://host.example' }), /HTTPS/)
  assert.throws(() => offers.mintPublic({ ...base, endpoint: 'https://host.example', ice: ['turn:turn.example'] }), /STUN-only/)
})

test('direct offer targets the installed Android app and carries STUN-only discovery', () => {
  const offers = new PairingOfferManager(300_000)
  const offer = offers.mint(
    'direct',
    'wss://signal.example.com',
    'a'.repeat(32),
    'pubkey-b64url',
    ['stun:stun.example.com:3478'],
  )
  assert.equal(offer.v, 3)
  assert.equal(offer.mode, 'direct')
  assert.deepEqual(offer.ice, ['stun:stun.example.com:3478'])
  const url = buildOfferUrl('dsh-mobile://pair', offer)
  assert.ok(url.startsWith('dsh-mobile://pair#offer='))
  assert.deepEqual(parseOfferUrl(url), offer)
})

test('QR: SVG and terminal renderings both produce output', async () => {
  const url = buildOfferUrl('https://app.example.com/', new PairingOfferManager(1000).mint('lan', 'http://x:1', null, 'k'))
  const svg = await QRCode.toString(url, { type: 'svg' })
  assert.ok(svg.startsWith('<svg'))
  const terminal = await QRCode.toString(url, { type: 'terminal', small: true })
  assert.ok(terminal.length > 100)
})
