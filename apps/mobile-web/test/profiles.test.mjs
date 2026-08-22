import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BrowserProfileStorage,
  HOST_PROFILE_SCHEMA_VERSION,
  HostIdentityMismatchError,
  MemoryProfileStorage,
  ProfileRepository,
} from '../src/profiles.ts'
import { MemoryCredentialVault } from '../src/credential-vault.ts'

const HOST_A = 'A'.repeat(43)
const HOST_B = 'B'.repeat(43)
const HOST_C = 'C'.repeat(43)

function profile(overrides = {}) {
  return {
    schemaVersion: HOST_PROFILE_SCHEMA_VERSION,
    hostId: HOST_A,
    displayName: 'Studio host',
    endpoint: { url: 'https://first.example', kind: 'temporary' },
    capabilities: ['tunnel'],
    credentialRef: 'vault:opaque-A',
    room: '0123456789abcdef0123456789abcdef',
    ice: ['stun:stun.example.com:3478'],
    connectionPolicy: 'automatic',
    presentation: {},
    createdAt: '2026-08-16T10:00:00.000Z',
    updatedAt: '2026-08-16T10:00:00.000Z',
    ...overrides,
  }
}

test('same Host Identity upsert refreshes one Host Profile and makes the first Host active', async () => {
  const repository = new ProfileRepository(new MemoryProfileStorage(), new MemoryCredentialVault())

  await repository.upsert(profile())
  await repository.upsert(profile({
    displayName: 'Studio host renamed',
    endpoint: { url: 'https://rotated.example', kind: 'temporary' },
    capabilities: ['direct', 'tunnel'],
    updatedAt: '2026-08-16T11:00:00.000Z',
  }))

  assert.deepEqual(await repository.list(), [profile({
    displayName: 'Studio host renamed',
    endpoint: { url: 'https://rotated.example', kind: 'temporary' },
    capabilities: ['direct', 'tunnel'],
    updatedAt: '2026-08-16T11:00:00.000Z',
  })])
  assert.equal((await repository.getActive())?.hostId, HOST_A)
})

test('sealed Host metadata updates presentation name without changing endpoint or Room', async () => {
  const repository = new ProfileRepository(new MemoryProfileStorage(), new MemoryCredentialVault())
  await repository.upsert(profile({ displayName: 'relay.example' }))

  const renamed = await repository.updateDisplayName(HOST_A, 'Noir Workstation')

  assert.equal(renamed.displayName, 'Noir Workstation')
  assert.equal(renamed.endpoint.url, 'https://first.example')
  assert.equal(renamed.room, '0123456789abcdef0123456789abcdef')
})

test('Endpoint Refresh preserves authorization and Active Host selection across multiple Profiles', async () => {
  const storage = new MemoryProfileStorage()
  const repository = new ProfileRepository(storage, new MemoryCredentialVault())
  await repository.upsert(profile())
  await repository.upsert(profile({
    hostId: HOST_B,
    displayName: 'Travel host',
    endpoint: { url: 'https://travel.example', kind: 'custom' },
    credentialRef: 'vault:opaque-B',
  }))
  await repository.setActiveHost(HOST_B)

  const refreshed = await repository.refreshEndpoint(HOST_A, {
    endpoint: { url: 'https://current.example', kind: 'custom' },
    capabilities: ['direct'],
    updatedAt: '2026-08-16T12:00:00.000Z',
  })

  assert.equal(refreshed.credentialRef, 'vault:opaque-A')
  assert.deepEqual(refreshed.endpoint, { url: 'https://current.example', kind: 'custom' })
  assert.deepEqual(refreshed.capabilities, ['direct'])
  assert.equal((await repository.getActive())?.hostId, HOST_B)

  const restored = new ProfileRepository(storage, new MemoryCredentialVault())
  assert.equal((await restored.getActive())?.hostId, HOST_B)
  await assert.rejects(() => restored.setActiveHost(HOST_C), /unknown Host Identity/)
})

test('Endpoint Refresh rejects another Host endpoint and malformed metadata', async () => {
  const repository = new ProfileRepository(new MemoryProfileStorage(), new MemoryCredentialVault())
  await repository.upsert(profile())
  await repository.upsert(profile({
    hostId: HOST_B,
    endpoint: { url: 'https://travel.example', kind: 'custom' },
    credentialRef: 'vault:opaque-B',
  }))

  await assert.rejects(
    () => repository.refreshEndpoint(HOST_A, {
      endpoint: { url: 'https://travel.example', kind: 'custom' },
      capabilities: ['direct'],
      updatedAt: '2026-08-16T12:00:00.000Z',
    }),
    /different Host Identity/,
  )
  await assert.rejects(
    () => repository.refreshEndpoint(HOST_A, {
      endpoint: { url: 'https://valid.example', kind: 'custom' },
      capabilities: [42],
      updatedAt: '2026-08-16T12:00:00.000Z',
    }),
    /invalid Endpoint Refresh/,
  )
  const injected = await repository.refreshEndpoint(HOST_A, {
    endpoint: { url: 'https://valid.example', kind: 'custom' },
    capabilities: ['direct'],
    updatedAt: '2026-08-16T12:00:00.000Z',
    credentialRef: 'vault:opaque-B',
    hostId: HOST_B,
  })
  assert.equal(injected.hostId, HOST_A)
  assert.equal(injected.credentialRef, 'vault:opaque-A')
  assert.deepEqual((await repository.list()).find(saved => saved.hostId === HOST_A)?.endpoint, {
    url: 'https://valid.example',
    kind: 'custom',
  })
})

test('Profile Removal is offline, deletes only its local credential, and keeps one remaining Active Host', async () => {
  const vault = new MemoryCredentialVault()
  const firstRef = await vault.store(new TextEncoder().encode('first-token'))
  const secondRef = await vault.store(new TextEncoder().encode('second-token'))
  const repository = new ProfileRepository(new MemoryProfileStorage(), vault)
  await repository.upsert(profile({ credentialRef: firstRef }))
  await repository.upsert(profile({ hostId: HOST_B, endpoint: { url: 'https://travel.example', kind: 'custom' }, credentialRef: secondRef }))
  await repository.setActiveHost(HOST_A)

  assert.equal(await repository.remove(HOST_A), true)
  assert.equal(await vault.read(firstRef), undefined)
  assert.notEqual(await vault.read(secondRef), undefined)
  assert.equal((await repository.getActive())?.hostId, HOST_B)
  assert.equal(await repository.remove(HOST_C), false)
})

class FailingStorage {
  #memory = new MemoryProfileStorage()
  failNextSave = false
  load() { return this.#memory.load() }
  async save(document) {
    if (this.failNextSave) {
      this.failNextSave = false
      throw new Error('profile metadata unavailable')
    }
    await this.#memory.save(document)
  }
}

class FakeStorage {
  #values = new Map()
  getItem(key) { return this.#values.get(key) ?? null }
  setItem(key, value) { this.#values.set(key, value) }
  removeItem(key) { this.#values.delete(key) }
}

test('browser ProfileRepository restores versioned Profiles and last Active Host', async () => {
  const browserStorage = new FakeStorage()
  const vault = new MemoryCredentialVault()
  const repository = new ProfileRepository(new BrowserProfileStorage(browserStorage), vault)
  await repository.upsert(profile())
  await repository.upsert(profile({ hostId: HOST_B, endpoint: { url: 'https://travel.example', kind: 'custom' }, credentialRef: 'vault:opaque-B' }))
  await repository.setActiveHost(HOST_B)

  const restored = new ProfileRepository(new BrowserProfileStorage(browserStorage), vault)
  assert.equal((await restored.getActive())?.hostId, HOST_B)
  assert.deepEqual((await restored.list()).map(saved => saved.hostId), [
    HOST_A,
    HOST_B,
  ])
})

test('an endpoint presenting a different Host Identity cannot overwrite a saved Profile', async () => {
  const repository = new ProfileRepository(new MemoryProfileStorage(), new MemoryCredentialVault())
  await repository.upsert(profile())

  await assert.rejects(
    () => repository.upsert(profile({ hostId: HOST_C, credentialRef: 'vault:other' })),
    error => error instanceof HostIdentityMismatchError
      && error.savedHostId === HOST_A
      && error.presentedHostId === HOST_C,
  )
  assert.deepEqual((await repository.list()).map(saved => saved.hostId), [HOST_A])
})

test('explicit acknowledgement continues pairing after an endpoint changes Host Identity', async () => {
  const vault = new MemoryCredentialVault()
  const oldRef = await vault.store(new TextEncoder().encode('old-host-token'))
  const newRef = await vault.store(new TextEncoder().encode('new-host-token'))
  const repository = new ProfileRepository(new MemoryProfileStorage(), vault)
  await repository.upsert(profile({ credentialRef: oldRef }))
  const replacement = profile({ hostId: HOST_C, credentialRef: newRef, displayName: 'Reset Host' })

  let conflict
  try {
    await repository.upsert(replacement)
  } catch (error) {
    conflict = error
  }
  assert.ok(conflict instanceof HostIdentityMismatchError)
  await repository.acknowledgeIdentityChange(conflict, replacement)

  assert.deepEqual((await repository.list()).map(saved => saved.hostId), [HOST_C])
  assert.equal((await repository.getActive())?.hostId, HOST_C)
  assert.equal(await vault.read(oldRef), undefined)
  assert.notEqual(await vault.read(newRef), undefined)
})

test('ProfileRepository rejects values that are not cryptographic Host public-key identities', async () => {
  const repository = new ProfileRepository(new MemoryProfileStorage(), new MemoryCredentialVault())
  await assert.rejects(
    () => repository.upsert(profile({ hostId: '__proto__' })),
    /invalid Host Identity/,
  )
  assert.deepEqual(await repository.list(), [])
  assert.equal(await repository.getActive(), undefined)
  await assert.rejects(() => repository.setActiveHost('__proto__'), /invalid Host Identity/)
})

test('HostProfile persists a v4 room and accepts only STUN ICE discovery URLs', async () => {
  const repository = new ProfileRepository(new MemoryProfileStorage(), new MemoryCredentialVault())
  await assert.rejects(
    () => repository.upsert(profile({ room: 'ABCDEF0123456789ABCDEF0123456789' })),
    /invalid HostProfile/,
  )
  await assert.rejects(
    () => repository.upsert(profile({ ice: ['turn:turn.example.com:3478'] })),
    /invalid HostProfile/,
  )
  await assert.rejects(
    () => repository.upsert(profile({ ice: ['stun:'] })),
    /invalid HostProfile/,
  )

  const saved = await repository.upsert(profile())
  assert.equal(saved.room, '0123456789abcdef0123456789abcdef')
  assert.deepEqual(saved.ice, ['stun:stun.example.com:3478'])
})

test('versioned HostProfile schema requires per-Host local presentation state', async () => {
  const repository = new ProfileRepository(new MemoryProfileStorage(), new MemoryCredentialVault())
  const missingPresentation = profile()
  delete missingPresentation.presentation

  await assert.rejects(() => repository.upsert(missingPresentation), /invalid HostProfile/)
})

test('ProfileRepository rejects unsupported HostProfile schema versions', async () => {
  const repository = new ProfileRepository(new MemoryProfileStorage(), new MemoryCredentialVault())
  await assert.rejects(
    () => repository.upsert(profile({ schemaVersion: 2 })),
    /unsupported HostProfile schema version/,
  )
  assert.deepEqual(await repository.list(), [])
})

test('one opaque credential ref cannot be owned by multiple Host Profiles', async () => {
  const repository = new ProfileRepository(new MemoryProfileStorage(), new MemoryCredentialVault())
  await repository.upsert(profile())

  await assert.rejects(
    () => repository.upsert(profile({
      hostId: HOST_B,
      endpoint: { url: 'https://travel.example', kind: 'custom' },
    })),
    /credential ref already belongs to another Host/,
  )
  assert.deepEqual((await repository.list()).map(saved => saved.hostId), [HOST_A])
})

test('a stale Profile write cannot roll credentialRef back to a deleted pairing secret', async () => {
  const vault = new MemoryCredentialVault()
  const pairingRef = await vault.store(new TextEncoder().encode('pairing-code'))
  const tokenRef = await vault.store(new TextEncoder().encode('device-token'))
  const repository = new ProfileRepository(new MemoryProfileStorage(), vault)
  await repository.upsert(profile({ credentialRef: pairingRef }))
  await repository.upsert(profile({ credentialRef: tokenRef, updatedAt: '2026-08-16T13:00:00.000Z' }))
  await vault.delete(pairingRef)

  const kept = await repository.upsert(profile({
    credentialRef: pairingRef,
    presentation: { officialLayoutRevision: 'host-layout' },
    updatedAt: '2026-08-16T13:01:00.000Z',
  }))

  assert.equal(kept.credentialRef, tokenRef)
  assert.notEqual(await vault.read(tokenRef), undefined)
  assert.equal((await repository.getActive()).credentialRef, tokenRef)
})

test('same-Host upsert deletes a superseded local credential without duplicating the Profile', async () => {
  const vault = new MemoryCredentialVault()
  const oldRef = await vault.store(new TextEncoder().encode('old-token'))
  const newRef = await vault.store(new TextEncoder().encode('new-token'))
  const repository = new ProfileRepository(new MemoryProfileStorage(), vault)
  await repository.upsert(profile({ credentialRef: oldRef }))

  await repository.upsert(profile({ credentialRef: newRef, updatedAt: '2026-08-16T13:00:00.000Z' }))

  assert.equal(await vault.read(oldRef), undefined)
  assert.notEqual(await vault.read(newRef), undefined)
  assert.equal((await repository.list()).length, 1)
})

test('failed metadata commit preserves the currently referenced credential', async () => {
  const storage = new FailingStorage()
  const vault = new MemoryCredentialVault()
  const oldRef = await vault.store(new TextEncoder().encode('old-token'))
  const newRef = await vault.store(new TextEncoder().encode('new-token'))
  const repository = new ProfileRepository(storage, vault)
  await repository.upsert(profile({ credentialRef: oldRef }))
  storage.failNextSave = true

  await assert.rejects(
    () => repository.upsert(profile({ credentialRef: newRef, updatedAt: '2026-08-16T13:00:00.000Z' })),
    /metadata unavailable/,
  )

  assert.equal((await repository.getActive())?.credentialRef, oldRef)
  assert.notEqual(await vault.read(oldRef), undefined)
  assert.notEqual(await vault.read(newRef), undefined)
})

test('concurrent Profile mutations preserve every Host and the last completed Active Host selection', async () => {
  const repository = new ProfileRepository(new MemoryProfileStorage(), new MemoryCredentialVault())
  await Promise.all([
    repository.upsert(profile()),
    repository.upsert(profile({
      hostId: HOST_B,
      endpoint: { url: 'https://travel.example', kind: 'custom' },
      credentialRef: 'vault:opaque-B',
    })),
  ])
  await Promise.all([
    repository.setActiveHost(HOST_A),
    repository.setActiveHost(HOST_B),
  ])

  assert.deepEqual((await repository.list()).map(saved => saved.hostId), [
    HOST_A,
    HOST_B,
  ])
  assert.equal((await repository.getActive())?.hostId, HOST_B)
})
