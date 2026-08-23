import test from 'node:test'
import assert from 'node:assert/strict'
import { b64urlEncode, parseOffer } from '@dsh-mobile/e2e-tunnel'
import { MemoryCredentialVault } from '../src/credential-vault.ts'
import { MemoryProfileStorage, ProfileRepository } from '../src/profiles.ts'
import { decodeSessionCredential } from '../src/session-credentials.ts'
import { prepareProfileConnection } from '../src/profile-connection.ts'

const hostId = b64urlEncode(new Uint8Array(32).fill(7))
const room = 'a'.repeat(32)
const keypair = { publicKey: new Uint8Array(32).fill(1), secretKey: new Uint8Array(32).fill(2) }
const offerUrl = (over = {}) => 'dsh-mobile://pair#offer=' + b64urlEncode(new TextEncoder().encode(JSON.stringify({
  v: 4, mode: 'public', protocol: 1, endpoint: 'https://host.example', endpointKind: 'temporary',
  room, pubkey: hostId, code: '123456', exp: Math.floor(Date.now() / 1000) + 300, ice: ['stun:stun.example.com:3478'],
  capabilities: { browser: false, direct: true, tunnel: true, endpointRefresh: true }, hostName: 'Noir Workstation', ...over,
})))

function fixture() {
  const vault = new MemoryCredentialVault()
  return { vault, repository: new ProfileRepository(new MemoryProfileStorage(), vault) }
}

test('new v4 pairing stores retry key and code only in the vault and activates one Host Profile', async () => {
  const { vault, repository } = fixture()
  const prepared = await prepareProfileConnection({ repository, vault, offerUrl: offerUrl(), generateKeypair: () => keypair, now: () => new Date('2026-01-01T00:00:00Z') })
  const active = await repository.getActive()
  assert.equal(active.hostId, hostId)
  assert.equal(active.room, room)
  assert.equal(active.endpoint.url, 'https://host.example')
  assert.equal(active.displayName, 'Noir PC')
  assert.deepEqual(active.ice, ['stun:stun.example.com:3478'])
  assert.equal(prepared.offerUrl, offerUrl())
  const secret = decodeSessionCredential(await vault.read(active.credentialRef))
  assert.equal(secret.pairingCode, '123456')
  assert.equal(secret.deviceToken, undefined)
})

test('issued token is durably swapped into the vault before connection open', async () => {
  const { vault, repository } = fixture()
  const prepared = await prepareProfileConnection({ repository, vault, offerUrl: offerUrl(), generateKeypair: () => keypair })
  const before = await repository.getActive()
  const loaded = await prepared.loadCredentials()
  await loaded.onDeviceToken('device-token')
  loaded.dispose()
  const after = await repository.getActive()
  assert.equal(after.credentialRef, before.credentialRef)
  assert.equal(prepared.profile.credentialRef, after.credentialRef)
  const persisted = decodeSessionCredential(await vault.read(after.credentialRef))
  assert.equal(persisted.deviceToken, 'device-token')
  assert.equal(persisted.pairingCode, undefined)
})

test('a scanned offer replaces a Host Profile whose vault credential is gone', async () => {
  const { vault, repository } = fixture()
  await prepareProfileConnection({
    repository, vault, offerUrl: offerUrl(),
    generateKeypair: () => ({ publicKey: keypair.publicKey.slice(), secretKey: keypair.secretKey.slice() }),
  })
  const before = await repository.getActive()
  await vault.delete(before.credentialRef)
  await prepareProfileConnection({
    repository, vault, offerUrl: offerUrl({ code: '654321' }),
    generateKeypair: () => ({ publicKey: new Uint8Array(32).fill(3), secretKey: new Uint8Array(32).fill(4) }),
  })
  const after = await repository.getActive()
  assert.notEqual(after.credentialRef, before.credentialRef)
  assert.equal((await repository.list()).length, 1)
  const secret = decodeSessionCredential(await vault.read(after.credentialRef))
  assert.equal(secret.pairingCode, '654321')
})

test('a transient vault read error does not delete the Host Profile', async () => {
  const { vault, repository } = fixture()
  await prepareProfileConnection({
    repository, vault, offerUrl: offerUrl(),
    generateKeypair: () => ({ publicKey: keypair.publicKey.slice(), secretKey: keypair.secretKey.slice() }),
  })
  const before = await repository.getActive()
  const failingVault = {
    store: vault.store.bind(vault),
    replace: vault.replace.bind(vault),
    delete: vault.delete.bind(vault),
    read: async () => { throw new Error('keystore busy') },
  }
  await assert.rejects(
    prepareProfileConnection({ repository, vault: failingVault, offerUrl: offerUrl({ code: '654321' }) }),
    /keystore busy/,
  )
  const after = await repository.getActive()
  assert.equal((await repository.list()).length, 1)
  assert.equal(after.hostId, before.hostId)
  assert.equal(after.credentialRef, before.credentialRef)
})

test('persisting a device token does not delete the live vault ref if the process dies next', async () => {
  const { vault, repository } = fixture()
  const prepared = await prepareProfileConnection({ repository, vault, offerUrl: offerUrl(), generateKeypair: () => keypair })
  const loaded = await prepared.loadCredentials()
  await loaded.onDeviceToken('device-token')
  loaded.dispose()
  const resumed = await prepareProfileConnection({ repository, vault })
  const again = await resumed.loadCredentials()
  assert.equal(again.deviceToken, 'device-token')
  again.dispose()
})

test('saved active Profile reconstructs v4 connection metadata without localStorage credentials', async () => {
  const { vault, repository } = fixture()
  const first = await prepareProfileConnection({ repository, vault, offerUrl: offerUrl(), generateKeypair: () => keypair })
  const claim = await first.loadCredentials(); await claim.onDeviceToken('device-token'); claim.dispose()
  const resumed = await prepareProfileConnection({ repository, vault })
  const parsed = parseOffer(resumed.offerUrl, { allowExpired: true })
  assert.equal(parsed.mode, 'public')
  assert.equal(parsed.room, room)
  const loaded = await resumed.loadCredentials()
  assert.equal(loaded.deviceToken, 'device-token')
  loaded.dispose()
})

test('a second Host with the same display name is labeled by its endpoint host', async () => {
  const { vault, repository } = fixture()
  await prepareProfileConnection({ repository, vault, offerUrl: offerUrl(), generateKeypair: () => ({ publicKey: keypair.publicKey.slice(), secretKey: keypair.secretKey.slice() }) })
  const otherHost = b64urlEncode(new Uint8Array(32).fill(8))
  const second = await prepareProfileConnection({
    repository,
    vault,
    offerUrl: offerUrl({ pubkey: otherHost, endpoint: 'https://lab.example', room: 'b'.repeat(32) }),
    generateKeypair: () => ({ publicKey: new Uint8Array(32).fill(3), secretKey: new Uint8Array(32).fill(4) }),
  })
  assert.equal((await repository.list()).length, 2)
  assert.equal((await repository.list()).find(item => item.hostId === hostId)?.displayName, 'Noir PC')
  assert.equal(second.profile.displayName, 'Noir PC · lab.example')
})

test('a second Host on the same Public Endpoint is saved beside the first', async () => {
  const { vault, repository } = fixture()
  await prepareProfileConnection({ repository, vault, offerUrl: offerUrl(), generateKeypair: () => ({ publicKey: keypair.publicKey.slice(), secretKey: keypair.secretKey.slice() }) })
  const otherHost = b64urlEncode(new Uint8Array(32).fill(8))
  const second = await prepareProfileConnection({
    repository,
    vault,
    offerUrl: offerUrl({ pubkey: otherHost, room: 'b'.repeat(32) }),
    generateKeypair: () => ({ publicKey: new Uint8Array(32).fill(3), secretKey: new Uint8Array(32).fill(4) }),
  })
  const listed = await repository.list()
  assert.equal(listed.length, 2)
  assert.equal(listed.find(item => item.hostId === hostId)?.endpoint.url, 'https://host.example')
  assert.equal(second.profile.endpoint.url, 'https://host.example')
  assert.equal(second.profile.hostId, otherHost)
  assert.equal((await repository.getActive()).hostId, otherHost)
})

test('scanning a new Host Identity on a shared endpoint does not require replacing the saved Host', async () => {
  const { vault, repository } = fixture()
  await prepareProfileConnection({ repository, vault, offerUrl: offerUrl(), generateKeypair: () => ({ publicKey: keypair.publicKey.slice(), secretKey: keypair.secretKey.slice() }) })
  const changedHost = b64urlEncode(new Uint8Array(32).fill(9))
  const changed = offerUrl({ pubkey: changedHost, room: 'c'.repeat(32) })
  const second = await prepareProfileConnection({
    repository, vault, offerUrl: changed,
    generateKeypair: () => ({ publicKey: new Uint8Array(32).fill(5), secretKey: new Uint8Array(32).fill(6) }),
    acknowledgeIdentityChange: () => false,
  })
  assert.equal(second.profile.hostId, changedHost)
  assert.equal((await repository.list()).length, 2)
})

test('a new pairing code replaces a stale mint room before a token exists', async () => {
  const { vault, repository } = fixture()
  await prepareProfileConnection({
    repository, vault, offerUrl: offerUrl({ room: 'e'.repeat(32) }),
    generateKeypair: () => ({ publicKey: keypair.publicKey.slice(), secretKey: keypair.secretKey.slice() }),
  })
  const prepared = await prepareProfileConnection({
    repository, vault, offerUrl: offerUrl({ code: '654321', room: 'f'.repeat(32) }),
    generateKeypair: () => { throw new Error('must reuse') },
  })
  assert.equal(prepared.profile.room, 'f'.repeat(32))
  const claim = await prepared.loadCredentials()
  await claim.onDeviceToken('device-token')
  claim.dispose()
  assert.equal((await repository.getActive()).room, 'f'.repeat(32))
})

test('same Host Endpoint Refresh keeps the authorized room while rotating the endpoint', async () => {
  const { vault, repository } = fixture()
  const first = await prepareProfileConnection({ repository, vault, offerUrl: offerUrl(), generateKeypair: () => ({ publicKey: keypair.publicKey.slice(), secretKey: keypair.secretKey.slice() }) })
  const claim = await first.loadCredentials(); await claim.onDeviceToken('device-token'); claim.dispose()
  const before = await repository.getActive()
  const refreshed = await prepareProfileConnection({
    repository, vault, offerUrl: offerUrl({ endpoint: 'https://rotated.example', room: 'd'.repeat(32) }),
    generateKeypair: () => { throw new Error('must reuse authorized credential') },
  })
  const loaded = await refreshed.loadCredentials()
  assert.equal(loaded.deviceToken, 'device-token')
  loaded.dispose()
  assert.equal(refreshed.profile.room, before.room)
  assert.equal(refreshed.profile.endpoint.url, 'https://rotated.example')
  assert.equal(parseOffer(refreshed.offerUrl, { allowExpired: true }).room, before.room)
  assert.equal((await repository.getActive()).credentialRef, before.credentialRef)
})

test('Official Relay offers persist a shared WSS endpoint without STUN metadata', async () => {
  const { vault, repository } = fixture()
  const relay = 'dsh-mobile://pair#offer=' + b64urlEncode(new TextEncoder().encode(JSON.stringify({
    v: 2, mode: 'relay', addr: 'wss://relay.example.com', room: 'a'.repeat(32), pubkey: hostId, code: '123456', exp: Math.floor(Date.now() / 1000) + 300,
  })))
  const prepared = await prepareProfileConnection({ repository, vault, offerUrl: relay, generateKeypair: () => keypair })
  assert.deepEqual(prepared.profile.endpoint, { url: 'wss://relay.example.com', kind: 'relay' })
  assert.deepEqual(prepared.profile.ice, [])
  assert.equal(parseOffer(prepared.offerUrl).mode, 'relay')
})

test('same Host and room refreshes endpoint metadata without replacing authorization', async () => {
  const { vault, repository } = fixture()
  await prepareProfileConnection({ repository, vault, offerUrl: offerUrl(), generateKeypair: () => keypair })
  const before = await repository.getActive()
  const beforeSecret = decodeSessionCredential(await vault.read(before.credentialRef))
  await prepareProfileConnection({ repository, vault, offerUrl: offerUrl({ endpoint: 'https://rotated.example' }), generateKeypair: () => { throw new Error('must reuse') } })
  const after = await repository.getActive()
  const afterSecret = decodeSessionCredential(await vault.read(after.credentialRef))
  assert.equal(after.endpoint.url, 'https://rotated.example')
  assert.equal(after.credentialRef, before.credentialRef)
  assert.deepEqual(afterSecret.clientKeypair, beforeSecret.clientKeypair)
  assert.equal(afterSecret.pairingCode, '123456')
  assert.equal((await repository.list()).length, 1)
})
