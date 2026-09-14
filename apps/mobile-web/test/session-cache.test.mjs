import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PLUGIN_BUNDLE_DB_NAME } from '../src/plugin-cache.ts'
import {
  SESSION_CACHE_DB_NAME,
  createIndexedDbSessionCache,
  createMemorySessionRecordStore,
  createSessionCache,
} from '../../../packages/ui-layout-mobile/src/client/session-cache.ts'

const VAULT_SECRET = 'device-token-must-not-enter-session-cache'

function dirtyRow(sessionId, over = {}) {
  return {
    sessionId,
    title: sessionId,
    updatedAt: 10,
    blank: false,
    running: true,
    completed: true,
    pendingInteraction: 'question',
    pending: { kind: 'approval' },
    depth: 3,
    jobs: 4,
    deviceToken: VAULT_SECRET,
    clientKeypair: 'secret-bytes',
    ...over,
  }
}

function event(seq, text = String(seq), extra = {}) {
  return { type: 'user/message', seq, time: 100 + seq, data: { text }, ...extra }
}

test('missing IndexedDB yields no production session cache', () => {
  assert.equal(createIndexedDbSessionCache('host-a', null), undefined)
})

test('session cache uses a different IndexedDB than plugin bundles', () => {
  assert.equal(SESSION_CACHE_DB_NAME, 'dsh-mobile-session-cache-v2')
  assert.notEqual(SESSION_CACHE_DB_NAME, PLUGIN_BUNDLE_DB_NAME)
})

test('Host Identity partitions list and window records on a shared store', async () => {
  const store = createMemorySessionRecordStore()
  const a = createSessionCache('host-a', store)
  const b = createSessionCache('host-b', store)
  await a.writeList([dirtyRow('task-a')])
  await a.writeWindow('task-a', { entries: [{ event: event(1), view: { transient: true } }], hasMore: true })
  assert.equal(await b.readList(), undefined)
  assert.equal(await b.readWindow(), undefined)
  await b.writeList([dirtyRow('task-b', { title: 'B' })])
  assert.deepEqual(await a.readList(), [{
    sessionId: 'task-a', title: 'task-a', updatedAt: 10, blank: false,
  }])
  assert.deepEqual((await b.readList())?.map(row => row.sessionId), ['task-b'])
})

test('normalize drops running, completed, pending, depth, and live jobs', async () => {
  const cache = createSessionCache('host-a', createMemorySessionRecordStore())
  await cache.writeList([dirtyRow('s1', {
    parentSessionId: 'parent',
    origin: 'subagent',
    cwd: '/tmp/proj',
    agentPreset: 'ptc',
  })])
  assert.deepEqual(await cache.readList(), [{
    sessionId: 's1',
    title: 's1',
    updatedAt: 10,
    blank: false,
    parentSessionId: 'parent',
    origin: 'subagent',
    cwd: '/tmp/proj',
    agentPreset: 'ptc',
  }])
})

test('live session summaries map id and parentId onto the durable cache shape', async () => {
  const cache = createSessionCache('host-a', createMemorySessionRecordStore())
  await cache.writeList([{
    id: 'live-1',
    title: 'Live',
    updatedAt: 20,
    blank: true,
    parentId: 'root',
    origin: 'subagent',
    cwd: '/ws',
    running: true,
    projectionValues: { agentPreset: 'standard' },
  }])
  assert.deepEqual(await cache.readList(), [{
    sessionId: 'live-1',
    title: 'Live',
    updatedAt: 20,
    blank: true,
    parentSessionId: 'root',
    origin: 'subagent',
    cwd: '/ws',
    agentPreset: 'standard',
  }])
})

test('empty list and empty window commits overwrite a previous non-empty snapshot', async () => {
  const cache = createSessionCache('host-a', createMemorySessionRecordStore())
  await cache.writeList([dirtyRow('old')])
  await cache.writeWindow('old', { entries: [{ event: event(1) }], hasMore: false })
  await cache.writeList([])
  await cache.writeWindow('old', { entries: [], hasMore: false })
  assert.deepEqual(await cache.readList(), [])
  assert.deepEqual(await cache.readWindow(), { sessionId: 'old', window: { entries: [], hasMore: false } })
})

test('window persistence keeps event plus hasMore and strips Host view/render', async () => {
  const store = createMemorySessionRecordStore()
  const cache = createSessionCache('host-a', store)
  await cache.writeWindow('s1', {
    entries: [
      { type: 'event', event: event(1, 'hi'), view: { render: true } },
      { type: 'chunks', event: event(2, 'there'), render: { kind: 'host' } },
    ],
    hasMore: true,
  })
  assert.deepEqual(await cache.readWindow(), {
    sessionId: 's1',
    window: {
      entries: [{ event: event(1, 'hi') }, { event: event(2, 'there') }],
      hasMore: true,
    },
  })
  for (const value of store.records.values()) {
    assert.equal(JSON.stringify(value).includes('"view"'), false)
    assert.equal(JSON.stringify(value).includes('"render"'), false)
  }
})

test('only the current conversation window is retained per Host', async () => {
  const cache = createSessionCache('host-a', createMemorySessionRecordStore())
  await cache.writeWindow('first', { entries: [{ event: event(1) }], hasMore: false })
  await cache.writeWindow('second', { entries: [{ event: event(9) }], hasMore: true })
  assert.deepEqual(await cache.readWindow(), {
    sessionId: 'second',
    window: { entries: [{ event: event(9) }], hasMore: true },
  })
})

test('IndexedDB adapter round-trips through an injected record store', async () => {
  const store = createMemorySessionRecordStore()
  const cache = createIndexedDbSessionCache('host-a', store)
  assert.ok(cache)
  await cache.writeList([dirtyRow('s1')])
  await cache.writeWindow('s1', { entries: [{ event: event(3, 'cached') }], hasMore: false })
  const restored = createIndexedDbSessionCache('host-a', store)
  assert.deepEqual(await restored.readList(), [{
    sessionId: 's1', title: 's1', updatedAt: 10, blank: false,
  }])
  assert.equal((await restored.readWindow())?.window.entries[0]?.event.data.text, 'cached')
})

test('credentials never appear in session cache records', async () => {
  const store = createMemorySessionRecordStore()
  const cache = createSessionCache('host-a', store)
  await cache.writeList([dirtyRow('s1')])
  await cache.writeWindow('s1', {
    entries: [{ event: event(1, 'hello', { authorization: VAULT_SECRET }) }],
    hasMore: false,
  })
  assert.ok(store.records.size >= 1)
  for (const [key, value] of store.records) {
    const raw = JSON.stringify({ key, value })
    assert.equal(raw.includes(VAULT_SECRET), false)
    assert.equal(/deviceToken|clientKeypair|pairingSecret|privateKey/.test(raw), false)
  }
})

test('session cache module does not share the plugin bundle database', async () => {
  const cache = await readFile(new URL(
    '../../../packages/ui-layout-mobile/src/client/session-cache.ts',
    import.meta.url,
  ), 'utf8')
  assert.doesNotMatch(cache, /dsh-mobile-plugin-bundles/)
  assert.doesNotMatch(cache, /sessionHydration/)
})
