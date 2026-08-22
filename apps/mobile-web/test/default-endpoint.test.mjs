import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_PUBLIC_ENDPOINT,
  DEFAULT_PUBLIC_HOST_ID,
  migrateActiveTemporaryEndpoint,
} from '../src/default-endpoint.ts'

function profile(overrides = {}) {
  return {
    hostId: DEFAULT_PUBLIC_HOST_ID,
    endpoint: { url: 'https://old.trycloudflare.com', kind: 'temporary' },
    capabilities: ['direct', 'tunnel', 'endpointRefresh'],
    ...overrides,
  }
}

test('migrates the configured Host from Quick Tunnel to the stable endpoint', async () => {
  const saved = profile()
  let refresh
  const repository = {
    async getActive() { return saved },
    async refreshEndpoint(hostId, value) { refresh = { hostId, value }; return { ...saved, ...value } },
  }
  const changed = await migrateActiveTemporaryEndpoint(repository, DEFAULT_PUBLIC_ENDPOINT, () => new Date('2026-08-21T09:00:00.000Z'))
  assert.equal(changed, true)
  assert.deepEqual(refresh, {
    hostId: DEFAULT_PUBLIC_HOST_ID,
    value: {
      endpoint: { url: DEFAULT_PUBLIC_ENDPOINT, kind: 'custom' },
      capabilities: ['direct', 'tunnel', 'endpointRefresh'],
      updatedAt: '2026-08-21T09:00:00.000Z',
    },
  })
})

test('repairs the stale display label after endpoint migration', async () => {
  const saved = profile({
    displayName: 'old.trycloudflare.com',
    endpoint: { url: DEFAULT_PUBLIC_ENDPOINT, kind: 'custom' },
  })
  let updated
  const repository = {
    async getActive() { return saved },
    async refreshEndpoint() { throw new Error('refresh should not run') },
    async upsert(value) { updated = value; return value },
  }
  assert.equal(await migrateActiveTemporaryEndpoint(repository), true)
  assert.equal(updated.displayName, 'pair.noirbright.top')
})

test('does not rewrite custom or unrelated Host Profiles', async () => {
  for (const active of [
    profile({ endpoint: { url: DEFAULT_PUBLIC_ENDPOINT, kind: 'custom' } }),
    profile({ hostId: 'another-host-identity' }),
    profile({ endpoint: { url: 'https://custom.example', kind: 'custom' } }),
  ]) {
    let writes = 0
    const repository = {
      async getActive() { return active },
      async refreshEndpoint() { writes += 1; return active },
    }
    assert.equal(await migrateActiveTemporaryEndpoint(repository), false)
    assert.equal(writes, 0)
  }
})
