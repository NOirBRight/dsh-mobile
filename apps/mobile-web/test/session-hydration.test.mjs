import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareSessionHydration } from '../src/session-hydration.ts'

class MemoryDatabase {
  records = new Map()
  async readList(hostId) { return this.records.get(`dsh-mobile:${hostId}:sessions-list:v2`) }
  async readWindows(hostId) {
    return [...this.records.values()].filter(value => value?.hostId === hostId && value?.kind === 'window')
  }
  async writeList(record) { this.records.set(record.key, structuredClone(record)) }
  async writeWindow(record) { this.records.set(record.key, structuredClone(record)) }
  async writeMigration(list, windows) {
    const next = new Map(this.records)
    next.set(list.key, structuredClone(list))
    for (const record of windows) next.set(record.key, structuredClone(record))
    this.records = next
  }
  close() {}
}

class MemoryLegacyStorage {
  values = new Map()
  getItem(key) { return this.values.get(key) ?? null }
  setItem(key, value) { this.values.set(key, value) }
  removeItem(key) { this.values.delete(key) }
}

const listRow = (sessionId, over = {}) => ({
  sessionId, title: sessionId, updatedAt: 10, running: true, blank: false,
  pendingInteraction: 'question', completed: true, depth: 0, ...over,
})
const event = (seq, text = String(seq)) => ({ type: 'user/message', seq, time: 100 + seq, data: { text } })

test('v2 cache is Host-scoped, validated, and neutralizes volatile list state', async () => {
  const db = new MemoryDatabase()
  const a = await prepareSessionHydration({ hostId: 'host-a', database: db })
  a.adapter.committed({ kind: 'list', entries: [listRow('a')] })
  a.adapter.committed({
    kind: 'window', sessionId: 'a',
    window: { entries: [{ event: event(1), view: { transient: true } }], hasMore: true },
  })
  await a.flush()
  const b = await prepareSessionHydration({ hostId: 'host-b', database: db })
  assert.equal(b.adapter.readList(), undefined)
  assert.equal(b.adapter.readWindow('a'), undefined)
  const a2 = await prepareSessionHydration({ hostId: 'host-a', database: db })
  assert.deepEqual(a2.adapter.readList(), [{
    sessionId: 'a', title: 'a', updatedAt: 10, blank: false,
  }])
  assert.deepEqual(a2.adapter.readWindow('a'), { entries: [{ event: event(1) }], hasMore: true })
})

test('authoritative empty commits overwrite stale list and history without evicting other histories', async () => {
  const db = new MemoryDatabase()
  const prepared = await prepareSessionHydration({ hostId: 'host-a', database: db })
  prepared.adapter.committed({ kind: 'list', entries: [listRow('a'), listRow('b')] })
  prepared.adapter.committed({ kind: 'window', sessionId: 'a', window: { entries: [{ event: event(1) }], hasMore: false } })
  prepared.adapter.committed({ kind: 'window', sessionId: 'b', window: { entries: [{ event: event(2) }], hasMore: false } })
  await prepared.flush()
  prepared.adapter.committed({ kind: 'list', entries: [] })
  prepared.adapter.committed({ kind: 'window', sessionId: 'a', window: { entries: [], hasMore: false } })
  await prepared.flush()
  const restored = await prepareSessionHydration({ hostId: 'host-a', database: db })
  assert.deepEqual(restored.adapter.readList(), [])
  assert.deepEqual(restored.adapter.readWindow('a'), { entries: [], hasMore: false })
  assert.deepEqual(restored.adapter.readWindow('b'), { entries: [{ event: event(2) }], hasMore: false })
})

test('single-profile migration validates legacy v1 records and removes them after v2 persistence', async () => {
  const db = new MemoryDatabase()
  const legacy = new MemoryLegacyStorage()
  legacy.setItem('dsh-mobile:sessions-list:v1', JSON.stringify({ version: 1, entries: [listRow('old')] }))
  legacy.setItem('dsh-mobile:history:old', JSON.stringify({
    version: 1, events: [event(4)], views: [null], baseSeq: 4, hasMore: false,
  }))
  const migrated = await prepareSessionHydration({
    hostId: 'only-host', database: db, legacyStorage: legacy, allowLegacyMigration: true,
  })
  assert.equal(migrated.migratedLegacy, true)
  assert.deepEqual(migrated.adapter.readWindow('old'), { entries: [{ event: event(4) }], hasMore: false })
  assert.equal(legacy.getItem('dsh-mobile:sessions-list:v1'), null)
  assert.equal(legacy.getItem('dsh-mobile:history:old'), null)

  db.records.set('dsh-mobile:bad:sessions-list:v2', { key: 'x', kind: 'list', version: 2, hostId: 'bad', entries: [{ nope: true }] })
  const invalid = await prepareSessionHydration({ hostId: 'bad', database: db })
  assert.equal(invalid.adapter.readList(), undefined)
})

test('failed migration persists neither list nor history and remains retryable', async () => {
  class FailOnceDatabase extends MemoryDatabase {
    fail = true
    async writeMigration(list, windows) {
      if (this.fail) {
        this.fail = false
        throw new Error('transaction aborted')
      }
      await super.writeMigration(list, windows)
    }
  }
  const db = new FailOnceDatabase()
  const legacy = new MemoryLegacyStorage()
  legacy.setItem('dsh-mobile:sessions-list:v1', JSON.stringify({ version: 1, entries: [listRow('old')] }))
  legacy.setItem('dsh-mobile:history:old', JSON.stringify({
    version: 1, events: [event(4)], views: [null], baseSeq: 4, hasMore: false,
  }))
  const failed = await prepareSessionHydration({
    hostId: 'only-host', database: db, legacyStorage: legacy, allowLegacyMigration: true,
  })
  assert.equal(failed.migratedLegacy, false)
  assert.equal(db.records.has('dsh-mobile:only-host:sessions-list:v2'), false)
  assert.notEqual(legacy.getItem('dsh-mobile:sessions-list:v1'), null)

  const retried = await prepareSessionHydration({
    hostId: 'only-host', database: db, legacyStorage: legacy, allowLegacyMigration: true,
  })
  assert.equal(retried.migratedLegacy, true)
  assert.deepEqual(retried.adapter.readWindow('old'), { entries: [{ event: event(4) }], hasMore: false })
})

test('transient history write failure remains pending and retries without evicting prior history', async () => {
  class FailOnceWindowDatabase extends MemoryDatabase {
    fail = true
    async writeWindow(record) {
      if (this.fail) { this.fail = false; throw new Error('transient quota failure') }
      await super.writeWindow(record)
    }
  }
  const db = new FailOnceWindowDatabase()
  const prepared = await prepareSessionHydration({ hostId: 'host-a', database: db })
  prepared.adapter.committed({
    kind: 'window', sessionId: 'kept', window: { entries: [{ event: event(9) }], hasMore: false },
  })
  await prepared.flush()
  assert.equal(db.records.has('dsh-mobile:host-a:history:kept:v2'), false)
  await prepared.flush()
  assert.deepEqual(db.records.get('dsh-mobile:host-a:history:kept:v2')?.window, {
    entries: [{ event: event(9) }], hasMore: false,
  })
})

test('storage unavailability degrades to an empty non-throwing adapter', async () => {
  const prior = globalThis.indexedDB
  globalThis.indexedDB = undefined
  try {
    const prepared = await prepareSessionHydration({ hostId: 'host-a' })
    assert.equal(prepared.adapter.readList(), undefined)
    prepared.adapter.committed({ kind: 'list', entries: [] })
    await prepared.flush()
    await prepared.dispose()
  } finally {
    globalThis.indexedDB = prior
  }
})
