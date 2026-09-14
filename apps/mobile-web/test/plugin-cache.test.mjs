import test from 'node:test'
import assert from 'node:assert/strict'
import { DESKTOP_LAYOUT_ID, GZIP_PREFIX, gzipDecode, localizePluginBundles } from '../src/manifest.ts'
import { createDurablePluginCache, createIndexedDbPluginCache, readIndexedDbBootManifest, writeIndexedDbBootManifest } from '../src/plugin-cache.ts'

function memoryIndexedDB(options = {}) {
  const databases = new Map()
  const puts = []
  const failPut = options.failPut === true
  const done = value => {
    const request = { result: undefined, onsuccess: null, onerror: null }
    queueMicrotask(() => {
      request.result = value
      request.onsuccess?.({ target: request })
    })
    return request
  }
  const fail = () => {
    const request = { result: undefined, onsuccess: null, onerror: null, error: new Error('idb put failed') }
    queueMicrotask(() => request.onerror?.({ target: request }))
    return request
  }
  return {
    puts,
    open(name, version = 1) {
      const request = { result: undefined, onsuccess: null, onerror: null, onupgradeneeded: null }
      queueMicrotask(() => {
        let db = databases.get(name)
        if (db === undefined || db.version < version) {
          const stores = db?.stores ?? new Map()
          db = {
            version,
            stores,
            objectStoreNames: { contains: storeName => stores.has(storeName) },
            createObjectStore(storeName) {
              stores.set(storeName, new Map())
              return {}
            },
            transaction(storeName) {
              const store = stores.get(storeName)
              return {
                objectStore() {
                  return {
                    get(key) { return done(store.get(key)) },
                    put(value, key) {
                      if (failPut) return fail()
                      puts.push(value)
                      store.set(key, value)
                      return done(key)
                    },
                  }
                },
              }
            },
          }
          databases.set(name, db)
          request.result = db
          request.onupgradeneeded?.({ target: request })
        }
        request.result = databases.get(name)
        request.onsuccess?.({ target: request })
      })
      return request
    },
  }
}

function layoutEntry(rev = 'l1') {
  return { id: DESKTOP_LAYOUT_ID, url: '/plugins/' + DESKTOP_LAYOUT_ID + '/client.js?rev=' + rev, rev, inject: [] }
}

test('IndexedDB plugin cache keeps a Host roster larger than localStorage quota', async () => {
  const indexedDB = memoryIndexedDB()
  const cache = createIndexedDbPluginCache('host-a', indexedDB)
  assert.ok(cache)
  const source = 'export const n = ' + 'x'.repeat(80_000)
  await cache.write('@x/big', 'r1', source)
  assert.equal(await cache.read('@x/big', 'r1'), source)
  assert.equal(await cache.read('@x/big', 'r2'), undefined)
  const roster = {
    rev: 'host-rev',
    entries: [layoutEntry(), { id: '@x/big', url: '/plugins/@x/big.js?rev=r1', rev: 'r1', inject: [] }],
  }
  await writeIndexedDbBootManifest('host-a', roster, indexedDB)
  assert.deepEqual(await readIndexedDbBootManifest('host-a', indexedDB), roster)
})

test('hydrate localizes every cached bundle from IndexedDB without fetching', async () => {
  const indexedDB = memoryIndexedDB()
  const cache = createIndexedDbPluginCache('host-a', indexedDB)
  await cache.write('@deepseek-ai/dsh-cordis-client-runner', 'r1', 'export const runner = 1')
  await cache.write('dsh-codex-sidebar', 'e1', 'export const sidebar = 1')
  const localized = await localizePluginBundles({
    rev: 'host-rev',
    entries: [
      { id: '@deepseek-ai/dsh-cordis-client-runner', url: '/plugins/@deepseek-ai/dsh-cordis-client-runner/client.js?rev=r1', rev: 'r1' },
      { id: 'dsh-codex-sidebar', url: '/plugins/dsh-codex-sidebar/client.js?rev=e1', rev: 'e1' },
    ],
  }, {
    load: async () => { throw new Error('must not fetch during hydrate') },
    createUrl: (_source, id) => 'blob:' + id,
    cache,
    cacheOnly: true,
  })
  assert.equal(localized.entries[0].url, 'blob:@deepseek-ai/dsh-cordis-client-runner')
  assert.equal(localized.entries[1].url, 'blob:dsh-codex-sidebar')
})

test('cacheOnly hydrate fails when any IndexedDB bundle is missing', async () => {
  const cache = createIndexedDbPluginCache('host-a', memoryIndexedDB())
  await cache.write('@deepseek-ai/dsh-cordis-client-runner', 'r1', 'export const runner = 1')
  await assert.rejects(() => localizePluginBundles({
    rev: 'host-rev',
    entries: [
      { id: '@deepseek-ai/dsh-cordis-client-runner', url: '/plugins/@deepseek-ai/dsh-cordis-client-runner/client.js?rev=r1', rev: 'r1' },
      { id: 'dsh-codex-sidebar', url: '/plugins/dsh-codex-sidebar/client.js?rev=e1', rev: 'e1' },
    ],
  }, {
    load: async () => { throw new Error('must not fetch during hydrate') },
    createUrl: (_source, id) => 'blob:' + id,
    cache,
    cacheOnly: true,
  }), /plugin cache miss: dsh-codex-sidebar/)
})

test('IndexedDB plugin bundles are isolated per Host Identity', async () => {
  const indexedDB = memoryIndexedDB()
  const hostA = createIndexedDbPluginCache('host-a', indexedDB)
  const hostB = createIndexedDbPluginCache('host-b', indexedDB)
  await hostA.write('plugin', 'r1', 'source-a')
  await hostB.write('plugin', 'r1', 'source-b')
  assert.equal(await hostA.read('plugin', 'r1'), 'source-a')
  assert.equal(await hostB.read('plugin', 'r1'), 'source-b')
  await writeIndexedDbBootManifest('host-a', { rev: 'a', entries: [layoutEntry('a')] }, indexedDB)
  await writeIndexedDbBootManifest('host-b', { rev: 'b', entries: [layoutEntry('b')] }, indexedDB)
  assert.equal((await readIndexedDbBootManifest('host-a', indexedDB)).rev, 'a')
  assert.equal((await readIndexedDbBootManifest('host-b', indexedDB)).rev, 'b')
})

test('durable cache reads localStorage when IndexedDB misses', async () => {
  const indexedDB = memoryIndexedDB()
  const local = {
    async read(id, rev) { return id === 'legacy' && rev === 'r1' ? 'from-ls' : undefined },
    async write() { throw new Error('local write unused') },
  }
  const cache = createDurablePluginCache('host-a', local, indexedDB)
  await cache.write('fresh', 'r1', 'from-idb')
  assert.equal(await cache.read('fresh', 'r1'), 'from-idb')
  assert.equal(await cache.read('legacy', 'r1'), 'from-ls')
})

test('plugin and roster cache records do not store pairing credentials', async () => {
  const indexedDB = memoryIndexedDB()
  const cache = createIndexedDbPluginCache('host-a', indexedDB)
  await cache.write('@x/plugin', 'r1', 'export const plugin = 1')
  await writeIndexedDbBootManifest('host-a', { rev: 'r', entries: [layoutEntry()] }, indexedDB)
  const dumped = JSON.stringify(indexedDB.puts)
  assert.equal(/deviceToken|pairing.?code|nacl|credential/i.test(dumped), false)
})

test('a failed IndexedDB write does not abort a tunnel plugin download', async () => {
  const cache = createIndexedDbPluginCache('host-a', memoryIndexedDB({ failPut: true }))
  const localized = await localizePluginBundles({
    rev: 'host-rev',
    entries: [{ id: 'dsh-codex-sidebar', url: '/plugins/dsh-codex-sidebar/client.js?rev=e1', rev: 'e1' }],
  }, {
    load: async () => 'export const sidebar = 1',
    createUrl: (_source, id) => 'blob:' + id,
    cache,
  })
  assert.equal(localized.entries[0].url, 'blob:dsh-codex-sidebar')
})

test('IndexedDB still reads gzip-prefixed legacy bundle rows', async () => {
  const indexedDB = memoryIndexedDB()
  const cache = createIndexedDbPluginCache('host-a', indexedDB)
  await cache.read('missing', 'x')
  const source = 'export const legacy = 1'
  const compressed = await new Response(new Blob([source]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()
  const bytes = new Uint8Array(compressed)
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  const encoded = GZIP_PREFIX + btoa(binary)
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open('dsh-mobile-host-cache', 1)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  await new Promise((resolve, reject) => {
    const request = database.transaction('plugin-bundles').objectStore().put(encoded, 'host-a\0legacy\0r1')
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
  assert.equal(await cache.read('legacy', 'r1'), source)
  assert.equal(await gzipDecode(encoded), source)
})

test('a corrupt IndexedDB roster is ignored', async () => {
  const indexedDB = memoryIndexedDB()
  await writeIndexedDbBootManifest('host-a', { not: 'a roster' }, indexedDB)
  assert.equal(await readIndexedDbBootManifest('host-a', indexedDB), undefined)
})
