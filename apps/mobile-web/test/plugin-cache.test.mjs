import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { DESKTOP_LAYOUT_ID, localizePluginBundles } from '../src/manifest.ts'
import { createIndexedDbPluginCache } from '../src/plugin-cache.ts'

/** Injected record store: tests never boot a real IndexedDB engine. */
function memoryStore() {
  const records = new Map()
  return {
    records,
    async get(key) { return records.get(key) },
    async put(key, value) { records.set(key, value) },
  }
}

test('missing IndexedDB yields no plugin cache so cache-only hydrate cannot pretend a hit', () => {
  assert.equal(createIndexedDbPluginCache('host-a', null), undefined)
})

test('plugin bundle cache round-trips source through the PluginBundleCache port', async () => {
  const store = memoryStore()
  const cache = createIndexedDbPluginCache('host-a', store)
  assert.ok(cache)
  await cache.write('@x/plugin', 'rev1', 'export const n = 1\n')
  assert.equal(await cache.read('@x/plugin', 'rev1'), 'export const n = 1\n')
  assert.equal(await cache.read('@x/plugin', 'rev2'), undefined)
})

test('plugin cache records are keyed by Host Identity + id + rev', async () => {
  const store = memoryStore()
  const cache = createIndexedDbPluginCache('host-a', store)
  await cache.write('@x/plugin', 'rev1', 'source-a')
  assert.equal(store.records.has('host-a\0@x/plugin\0rev1'), true)
  assert.equal(store.records.has('host-b\0@x/plugin\0rev1'), false)
})

test('plugin caches store bundles gzip-compressed', async (t) => {
  if (typeof CompressionStream === 'undefined') { t.skip('no CompressionStream in this runtime'); return }
  const store = memoryStore()
  const cache = createIndexedDbPluginCache('host-a', store)
  const source = 'export const bundle = ' + JSON.stringify('js '.repeat(5000))
  await cache.write('@x/plugin', 'rev1', source)
  const raw = store.records.get('host-a\0@x/plugin\0rev1')
  assert.equal(typeof raw, 'string')
  assert.ok(raw.startsWith('gz1:'), 'stored value carries the gzip prefix')
  assert.ok(raw.length < source.length / 2, 'compressed value shrinks the payload')
  assert.equal(await cache.read('@x/plugin', 'rev1'), source)
})

test('a blob larger than the ~5MB localStorage origin cap round-trips', async () => {
  const store = memoryStore()
  const cache = createIndexedDbPluginCache('host-a', store)
  const source = 'export default "' + 'a'.repeat(5 * 1024 * 1024) + '"\n'
  await cache.write('@x/huge', '1', source)
  assert.equal(await cache.read('@x/huge', '1'), source)
  const raw = store.records.get('host-a\0@x/huge\0' + '1')
  assert.equal(typeof raw, 'string')
  assert.ok(raw.length > 0)
})

test('plugin bundle cache is isolated per Host Identity on a shared store', async () => {
  const store = memoryStore()
  const first = createIndexedDbPluginCache('host-a', store)
  const second = createIndexedDbPluginCache('host-b', store)
  await first.write('plugin-a', '1', 'from-a')
  assert.equal(await first.read('plugin-a', '1'), 'from-a')
  assert.equal(await second.read('plugin-a', '1'), undefined)
  await second.write('plugin-a', '1', 'from-b')
  assert.equal(await first.read('plugin-a', '1'), 'from-a')
  assert.equal(await second.read('plugin-a', '1'), 'from-b')
})

test('cache-only localization fails the whole graph on any IndexedDB miss', async () => {
  const store = memoryStore()
  const cache = createIndexedDbPluginCache('host-a', store)
  await cache.write('plugin-a', '1', 'source-a')
  const manifest = {
    rev: 'r',
    entries: [
      { id: DESKTOP_LAYOUT_ID, url: '/plugins/desktop.js', rev: 'desktop', inject: [] },
      { id: 'plugin-a', url: '/plugins/a.js', rev: '1', inject: [] },
    ],
  }
  let loads = 0
  await assert.rejects(
    localizePluginBundles(manifest, {
      load: async () => { loads += 1; return 'fetched' },
      createUrl: (_source, id) => id,
      cache,
      cacheOnly: true,
    }),
    /plugin cache miss: @deepseek-ai\/dsh-client-ui-layout/,
  )
  assert.equal(loads, 0)
  assert.equal(await cache.read('plugin-a', '1'), 'source-a')
})

test('plugin cache records are gzipped source only and never carry credentials', async () => {
  const store = memoryStore()
  const cache = createIndexedDbPluginCache('host-a', store)
  const vaultSecret = 'device-token-must-not-enter-plugin-cache'
  await cache.write('@x/plugin', 'rev1', 'export default 1\n')
  assert.equal(store.records.size, 1)
  for (const [key, value] of store.records) {
    assert.equal(typeof key, 'string')
    assert.equal(typeof value, 'string')
    assert.equal(key.includes(vaultSecret), false)
    assert.equal(value.includes(vaultSecret), false)
    assert.match(key, /^host-a\0@x\/plugin\0rev1$/)
    assert.equal(/deviceToken|clientKeypair|pairingSecret|privateKey/.test(key), false)
    assert.equal(/deviceToken|clientKeypair|pairingSecret|privateKey/.test(value), false)
    assert.notEqual(value[0], '{', 'records are encoded source strings, not JSON envelopes')
  }
})

test('tunnel writes plugin blobs through IndexedDB and keeps the boot roster on localStorage', async () => {
  const tunnel = await readFile(new URL('../src/tunnel.ts', import.meta.url), 'utf8')
  assert.match(tunnel, /from '\.\/plugin-cache\.ts'/)
  assert.match(tunnel, /createIndexedDbPluginCache\(/)
  assert.doesNotMatch(tunnel, /createLocalStoragePluginCache/)
  assert.match(tunnel, /writeCachedBootManifest/)
  assert.match(tunnel, /readCachedBootManifest/)
  assert.equal([...tunnel.matchAll(/createIndexedDbPluginCache\(/g)].length, 2)
})
