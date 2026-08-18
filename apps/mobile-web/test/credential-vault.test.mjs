import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BrowserCredentialVault,
  CredentialRePairRequiredError,
  MemoryCredentialVault,
  NativeCredentialVault,
  purgeLegacyAndroidWebCredentials,
} from '../src/credential-vault.ts'

const bytes = (value) => new TextEncoder().encode(value)

test('CredentialVault stores secrets behind opaque refs and deletes only the selected secret', async () => {
  const vault = new MemoryCredentialVault()
  const firstRef = await vault.store(bytes('first-host-token'))
  const secondRef = await vault.store(bytes('second-host-token'))

  assert.notEqual(firstRef, secondRef)
  assert.equal(firstRef.includes('first-host-token'), false)
  assert.deepEqual(await vault.read(firstRef), bytes('first-host-token'))

  await vault.delete(firstRef)
  assert.equal(await vault.read(firstRef), undefined)
  assert.deepEqual(await vault.read(secondRef), bytes('second-host-token'))
})

class FakeStorage {
  #values = new Map()
  getItem(key) { return this.#values.get(key) ?? null }
  setItem(key, value) { this.#values.set(key, value) }
  removeItem(key) { this.#values.delete(key) }
  keys() { return this.#values.keys() }
}

test('browser CredentialVault persists only within the supplied origin storage', async () => {
  const originA = new FakeStorage()
  const originB = new FakeStorage()
  const ref = await new BrowserCredentialVault(originA).store(bytes('origin-A-token'))

  assert.deepEqual(await new BrowserCredentialVault(originA).read(ref), bytes('origin-A-token'))
  assert.equal(await new BrowserCredentialVault(originB).read(ref), undefined)
})

test('unsupported browser credential records require an explicit re-pair path', async () => {
  const storage = new FakeStorage()
  const vault = new BrowserCredentialVault(storage)
  const ref = await vault.store(bytes('legacy-token'))
  for (const key of storage.keys()) storage.setItem(key, JSON.stringify({ schemaVersion: 0, token: 'legacy-token' }))

  await assert.rejects(() => vault.read(ref), error => error instanceof CredentialRePairRequiredError)
})

test('native migration purges legacy WebView offer and device token credentials', () => {
  const storage = new FakeStorage()
  storage.setItem('dsh-mobile.offer', 'legacy-offer')
  storage.setItem('dsh-mobile.deviceToken', 'legacy-token')
  storage.setItem('presentation-only', 'keep')
  purgeLegacyAndroidWebCredentials(storage)
  assert.equal(storage.getItem('dsh-mobile.offer'), null)
  assert.equal(storage.getItem('dsh-mobile.deviceToken'), null)
  assert.equal(storage.getItem('presentation-only'), 'keep')
})

test('app-private native CredentialVault transiently reads secrets without localStorage', async () => {
  const encryptedShellStorage = new Map()
  const bridge = {
    async storeSecret({ secretBase64 }) {
      const ref = 'vault:' + 'A'.repeat(43)
      encryptedShellStorage.set(ref, secretBase64)
      return { ref }
    },
    async readSecret({ ref }) {
      return { secretBase64: encryptedShellStorage.get(ref) }
    },
    async deleteSecret({ ref }) {
      encryptedShellStorage.delete(ref)
    },
    async replaceSecret({ ref, secretBase64 }) {
      encryptedShellStorage.set(ref, secretBase64)
    },
  }
  const vault = new NativeCredentialVault(bridge)

  const ref = await vault.store(bytes('native-host-token'))
  assert.equal(ref, 'vault:' + 'A'.repeat(43))
  assert.equal(ref.includes('native-host-token'), false)
  assert.deepEqual(await vault.read(ref), bytes('native-host-token'))
  await vault.delete(ref)
  assert.equal(await vault.read(ref), undefined)
  await assert.rejects(() => vault.store(new Uint8Array(65_537)), /too large/)

  const invalidRefVault = new NativeCredentialVault({
    async storeSecret() { return { ref: 'raw-secret-in-ref' } },
    async readSecret() { return {} },
    async deleteSecret() {},
    async replaceSecret() {},
  })
  await assert.rejects(() => invalidRefVault.store(bytes('token')), /invalid secret ref/)
})

test('vault replace overwrites the same ref so a later Profile write cannot delete the live secret', async () => {
  const vault = new MemoryCredentialVault()
  const ref = await vault.store(bytes('pairing-code'))
  await vault.replace(ref, bytes('device-token'))
  assert.deepEqual(await vault.read(ref), bytes('device-token'))
})
