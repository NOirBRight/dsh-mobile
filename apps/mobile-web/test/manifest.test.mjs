import test from 'node:test'
import assert from 'node:assert/strict'
import { adaptBootManifestForMobile, COLD_BOOT_PLUGIN_CONCURRENCY, createLocalStoragePluginCache, createMemoryPluginCache, extractBootManifestJson, readCachedBootManifest, writeCachedBootManifest, CONNECTION_ID, DESKTOP_LAYOUT_ID, DSH_HOST_BRIDGE_CAPABILITY, layoutCompatibilityMessage, loadSameOriginMobileBootManifest, localizePluginBundles, INTERACTION_OPERATIONS_ID, MOBILE_LAYOUT_ID, NARROW_LAYOUT_BREAKPOINT, officialNarrowContractAvailable, PLUGIN_LOAD_CONCURRENCY, readViewportWidth, selectResponsiveBootManifest, setSameOriginHostBridgeCapability, RUNTIME_ID } from '../src/manifest.ts'

test('extracts the boot graph from every historical host embedding form', () => {
  const graph = { rev: 'rev-1', entries: [{ id: 'x', url: '/plugins/x.js', rev: 'a' }] }
  const forms = [
    '<script>window.__DSH_BOOT__ = ' + JSON.stringify(graph) + '</script>',
    '<script>globalThis.__DSH_BOOT__ = ' + JSON.stringify(graph) + '</script>',
    '<script>globalThis["__DSH_BOOT__"] = ' + JSON.stringify(graph) + '</script>',
    "<script>globalThis['__DSH_BOOT__'] = " + JSON.stringify(graph) + '</script>',
  ]
  for (const html of forms) {
    assert.deepEqual(extractBootManifestJson(html), graph)
  }
  assert.throws(() => extractBootManifestJson('<html></html>', 'boot manifest not found in tunneled index'), /boot manifest not found in tunneled index/)
})

test('accepts alpha.1 entries without inject and rebuilds exact initial-load batches', () => {
  const selected = selectResponsiveBootManifest({
    rev: 'alpha.1',
    entries: [
      { id: '@deepseek-ai/dsh-client-modules', url: '/plugins/modules.js', rev: 'm', inject: [], immediately: true },
      { id: '@deepseek-ai/dsh-cordis-client-runner', url: '/plugins/runner.js', rev: 'r', inject: [] },
      // alpha.1 renderer intentionally omits inject.
      { id: '@deepseek-ai/dsh-client-ui-renderer', url: '/plugins/renderer.js', rev: 'u', immediately: true },
      { id: '@deepseek-ai/dsh-client-ui-session', url: '/plugins/session.js', rev: 's', inject: [] },
      { id: '@deepseek-ai/dsh-client-ui-theme', url: '/plugins/theme.js', rev: 't', inject: [] },
      {
        id: DESKTOP_LAYOUT_ID, url: '/plugins/layout.js', rev: 'l',
        inject: ['@deepseek-ai/dsh-client-ui-renderer', '@deepseek-ai/dsh-client-ui-session', '@deepseek-ai/dsh-client-ui-theme'],
      },
    ],
    batches: [{ phase: 'application', url: '/plugins/stale-batch.js', rev: 'old', entries: ['ghost'] }],
  }, { viewportWidth: 390 })
  assert.equal(selected.layout, 'narrow')
  assert.deepEqual(selected.manifest.entries.find(entry => entry.id === '@deepseek-ai/dsh-client-ui-renderer')?.inject, [])
  assert.equal(selected.manifest.batches?.length, selected.manifest.entries.length)
  for (const entry of selected.manifest.entries) {
    const batch = selected.manifest.batches?.filter(candidate => candidate.entries.includes(entry.id)) ?? []
    assert.equal(batch.length, 1, entry.id)
    assert.equal(batch[0].url, entry.url)
  }
})

test('replaces desktop layout and drops browser HMR without mutating host manifest', () => {
  const host = {
    rev: 'host-rev',
    entries: [
      { id: '@deepseek-ai/dsh-client-hmr', url: '/plugins/hmr.js', rev: 'hmr', inject: [], immediately: true },
      { id: 'before', url: '/plugins/before.js', rev: 'a', inject: [] },
      {
        id: '@deepseek-ai/dsh-client-ui-layout',
        url: '/plugins/desktop-layout.js',
        rev: 'desktop',
        inject: ['@deepseek-ai/dsh-client-ui-renderer', '@deepseek-ai/dsh-client-ui-session', '@deepseek-ai/dsh-client-ui-theme'],
      },
      { id: 'after', url: '/plugins/after.js', rev: 'b', inject: [] },
    ],
  }
  const snapshot = structuredClone(host)

  const mobile = adaptBootManifestForMobile(host)

  assert.deepEqual(host, snapshot)
  assert.equal(mobile.rev, 'host-rev+mobile-layout-0.1.30+mobile-interactions-0.1.14')
  assert.deepEqual(mobile.entries.map(entry => entry.id), ['before', MOBILE_LAYOUT_ID, 'after', INTERACTION_OPERATIONS_ID])
  assert.deepEqual(mobile.entries[1], {
    id: MOBILE_LAYOUT_ID,
    url: '/plugins/@dsh-mobile/ui-layout-mobile/client.js?rev=0.1.30',
    rev: '0.1.30',
    inject: ['@deepseek-ai/dsh-client-ui-renderer', '@deepseek-ai/dsh-client-ui-session', '@deepseek-ai/dsh-client-ui-theme'],
  })
})


test('readViewportWidth trusts a CSS-narrow viewport over an inflated JS width', () => {
  assert.equal(readViewportWidth({ matches: true, measured: 1080 }), NARROW_LAYOUT_BREAKPOINT - 1)
  assert.equal(readViewportWidth({ matches: false, measured: 900 }), 900)
  assert.equal(readViewportWidth({ matches: true, measured: 360 }), 360)
  assert.equal(readViewportWidth({ preferNarrow: true, measured: 980 }), NARROW_LAYOUT_BREAKPOINT - 1)
  assert.equal(readViewportWidth({ preferNarrow: true, measured: 360 }), 360)
})

test('selects only the narrow root below 696px and preserves the exact official entry at 696px', () => {
  const official = {
    id: DESKTOP_LAYOUT_ID,
    url: '/plugins/official/client.js?host-owned=1',
    rev: 'host-layout-rev',
    inject: ['host-owned-dependency'],
    immediately: true,
    hostField: { untouched: true },
  }
  const host = { rev: 'host', entries: [official, { id: 'leaf', url: '/plugins/leaf.js', rev: 'leaf', inject: [] }] }

  const wide = selectResponsiveBootManifest(host, { viewportWidth: NARROW_LAYOUT_BREAKPOINT })
  const narrow = selectResponsiveBootManifest(host, { viewportWidth: NARROW_LAYOUT_BREAKPOINT - 1 })

  assert.equal(wide.layout, 'official')
  assert.equal(wide.compatibility, 'compatible')
  assert.equal(wide.manifest.entries[0], official)
  assert.deepEqual(wide.manifest.entries[0], official)
  assert.equal(wide.manifest.entries.some(entry => entry.id === MOBILE_LAYOUT_ID), false)
  assert.equal(narrow.layout, 'narrow')
  assert.deepEqual(narrow.manifest.entries.map(entry => entry.id), [MOBILE_LAYOUT_ID, 'leaf', INTERACTION_OPERATIONS_ID])
  assert.ok(wide.manifest.entries.some(entry => entry.id === INTERACTION_OPERATIONS_ID))
})

test('continues narrow layout on harmless revision mismatch and reports it', () => {
  const host = {
    rev: 'host',
    entries: [{ id: DESKTOP_LAYOUT_ID, url: '/plugins/official.js', rev: 'newer-host-layout', inject: [] }],
  }

  const selected = selectResponsiveBootManifest(host, {
    viewportWidth: 320,
    expectedOfficialLayoutRevision: 'known-layout',
  })

  assert.equal(selected.layout, 'narrow')
  assert.equal(selected.compatibility, 'revision-mismatch')
  assert.equal(selected.officialLayoutRevision, 'newer-host-layout')
})

test('detects the official narrow slot contract and names visible compatibility notices', () => {
  const official = {
    id: DESKTOP_LAYOUT_ID,
    url: '/plugins/official.js',
    rev: 'host-layout',
    inject: ['@deepseek-ai/dsh-client-ui-renderer', '@deepseek-ai/dsh-client-ui-session', '@deepseek-ai/dsh-client-ui-theme'],
  }
  assert.equal(officialNarrowContractAvailable({ rev: 'host', entries: [official] }), true)
  assert.equal(officialNarrowContractAvailable({ rev: 'host', entries: [{ ...official, inject: [] }] }), false)
  assert.equal(layoutCompatibilityMessage('compatible'), null)
  assert.equal(layoutCompatibilityMessage('revision-mismatch'), null)
  assert.match(layoutCompatibilityMessage('missing-contract'), /官方布局/)
  assert.match(layoutCompatibilityMessage('layout-load-failed'), /窄屏布局加载失败/)
})

test('falls back to the official root when the narrow slot contract is missing', () => {
  const official = { id: DESKTOP_LAYOUT_ID, url: '/plugins/official.js', rev: 'host-layout', inject: [] }
  const selected = selectResponsiveBootManifest(
    { rev: 'host', entries: [official] },
    { viewportWidth: 320, narrowContractAvailable: false },
  )

  assert.equal(selected.layout, 'official')
  assert.equal(selected.compatibility, 'missing-contract')
  assert.equal(selected.manifest.entries[0], official)
})

test('retries the narrow layout until a remembered failed official revision still matches', () => {
  const official = { id: DESKTOP_LAYOUT_ID, url: '/plugins/official.js', rev: 'host-layout', inject: [] }
  const host = { rev: 'host', entries: [official] }

  const remembered = selectResponsiveBootManifest(host, {
    viewportWidth: 320,
    failedMobileLayoutRevision: 'host-layout',
  })
  assert.equal(remembered.layout, 'official')
  assert.equal(remembered.compatibility, 'layout-load-failed')
  assert.equal(remembered.manifest.entries[0], official)
  assert.equal(remembered.fallbackOfficial, undefined)

  const recovered = selectResponsiveBootManifest(host, {
    viewportWidth: 320,
    failedMobileLayoutRevision: 'older-host-layout',
  })
  assert.equal(recovered.layout, 'narrow')
  assert.equal(recovered.compatibility, 'compatible')
  assert.equal(recovered.fallbackOfficial?.layout, 'official')
  assert.equal(recovered.fallbackOfficial?.compatibility, 'layout-load-failed')
  assert.equal(recovered.fallbackOfficial?.officialLayoutRevision, 'host-layout')
})


test('localizes host plugin scripts while keeping the packaged mobile layout', async () => {
  const manifest = {
    rev: 'mobile',
    entries: [
      { id: 'runtime', url: '/plugins/runtime/client.js?rev=a', rev: 'a', inject: [] },
      { id: MOBILE_LAYOUT_ID, url: '/plugins/@dsh-mobile/ui-layout-mobile/client.js?rev=0.1.30', rev: '0.1.30', inject: [] },
      { id: INTERACTION_OPERATIONS_ID, url: '/plugins/@dsh-mobile/interaction-operations/client.js?rev=0.1.14', rev: '0.1.14', inject: [] },
      { id: CONNECTION_ID, url: '/plugins/@dsh-mobile/ui-layout-mobile/connection.js?rev=0.1.23', rev: '0.1.23', inject: [] },
      { id: 'leaf', url: '/plugins/leaf/client.js?rev=b', rev: 'b', inject: ['runtime'] },
    ],
  }
  const loaded = []
  const localized = await localizePluginBundles(manifest, {
    load: async url => { loaded.push(url); return '// ' + url },
    createUrl: (source, id) => 'blob:test/' + id + '/' + source.length,
  })

  assert.deepEqual(loaded, [
    '/plugins/runtime/client.js?rev=a',
    '/plugins/leaf/client.js?rev=b',
  ])
  assert.equal(localized.entries[0].url, 'blob:test/runtime/35')
  assert.equal(localized.entries[1].url, manifest.entries[1].url)
  assert.equal(localized.entries[2].url, manifest.entries[2].url)
  assert.equal(localized.entries[3].url, manifest.entries[3].url)
  assert.equal(localized.entries[4].url, 'blob:test/leaf/32')
  assert.deepEqual(manifest.entries.map(entry => entry.url), [
    '/plugins/runtime/client.js?rev=a',
    '/plugins/@dsh-mobile/ui-layout-mobile/client.js?rev=0.1.30',
    '/plugins/@dsh-mobile/interaction-operations/client.js?rev=0.1.14',
    '/plugins/@dsh-mobile/ui-layout-mobile/connection.js?rev=0.1.23',
    '/plugins/leaf/client.js?rev=b',
  ])
})

test('cached host plugins are not fetched again until revision changes', async () => {
  const cache = createMemoryPluginCache()
  const manifest = {
    rev: 'r1',
    entries: [
      { id: 'runtime', url: '/plugins/runtime/client.js?rev=a', rev: 'a', inject: [] },
      { id: 'leaf', url: '/plugins/leaf/client.js?rev=b', rev: 'b', inject: [] },
    ],
  }
  const loaded = []
  const load = async url => { loaded.push(url); return '// ' + url }
  await localizePluginBundles(manifest, { load, createUrl: (_source, id) => id, cache })
  assert.equal(loaded.length, 2)
  await localizePluginBundles(manifest, { load, createUrl: (_source, id) => id, cache })
  assert.equal(loaded.length, 2)
  await localizePluginBundles({
    ...manifest,
    entries: [
      { id: 'runtime', url: '/plugins/runtime/client.js?rev=a2', rev: 'a2', inject: [] },
      { id: 'leaf', url: '/plugins/leaf/client.js?rev=b', rev: 'b', inject: [] },
    ],
  }, { load, createUrl: (_source, id) => id, cache })
  assert.deepEqual(loaded, [
    '/plugins/runtime/client.js?rev=a',
    '/plugins/leaf/client.js?rev=b',
    '/plugins/runtime/client.js?rev=a2',
  ])
})

function countingLoader() {
  const state = { inFlight: 0, maxInFlight: 0 }
  return {
    state,
    async load(url) {
      state.inFlight += 1
      state.maxInFlight = Math.max(state.maxInFlight, state.inFlight)
      await new Promise(resolve => setTimeout(resolve, 20))
      state.inFlight -= 1
      return '// ' + url
    },
  }
}

function pluginManifest(count) {
  return {
    rev: 'r',
    entries: Array.from({ length: count }, (_unused, i) => ({ id: 'p' + i, url: '/plugins/p' + i + '.js', rev: '1', inject: [] })),
  }
}

test('a live Host session keeps plugin loads narrow so heartbeat pongs are not starved', async () => {
  const loader = countingLoader()
  await localizePluginBundles(pluginManifest(PLUGIN_LOAD_CONCURRENCY * 3), {
    load: loader.load,
    createUrl: (_source, id) => id,
  })
  assert.equal(loader.state.maxInFlight, PLUGIN_LOAD_CONCURRENCY)
})

test('a cold pairing widens the plugin pipe because every fetch costs a tunnel round trip', async () => {
  const loader = countingLoader()
  await localizePluginBundles(pluginManifest(COLD_BOOT_PLUGIN_CONCURRENCY * 3), {
    load: loader.load,
    createUrl: (_source, id) => id,
    concurrency: COLD_BOOT_PLUGIN_CONCURRENCY,
  })
  assert.ok(COLD_BOOT_PLUGIN_CONCURRENCY > PLUGIN_LOAD_CONCURRENCY)
  assert.equal(loader.state.maxInFlight, COLD_BOOT_PLUGIN_CONCURRENCY)
})

test('localization reports a monotonic progress count so a cold pairing is not a blank spinner', async () => {
  const loader = countingLoader()
  const seen = []
  const total = 10
  await localizePluginBundles(pluginManifest(total), {
    load: loader.load,
    createUrl: (_source, id) => id,
    concurrency: 4,
    onProgress: (loaded, reportedTotal) => seen.push([loaded, reportedTotal]),
  })
  assert.equal(seen.length, total)
  assert.deepEqual(seen.map(row => row[0]), Array.from({ length: total }, (_unused, i) => i + 1))
  assert.deepEqual(seen.at(-1), [total, total])
})

test('loads a validated raw same-origin manifest before responsive root selection', async () => {
  const host = {
    rev: 'host-direct',
    entries: [
      { id: '@deepseek-ai/dsh-client-connection', url: '/plugins/connection/client.js', rev: 'connection', inject: [] },
      { id: '@deepseek-ai/dsh-client-ui-layout', url: '/plugins/desktop/client.js', rev: 'desktop', inject: [] },
      { id: 'conversation', url: '/plugins/conversation/client.js', rev: 'conversation', inject: [] },
    ],
  }
  const requests = []
  const manifest = await loadSameOriginMobileBootManifest(async (input, init) => {
    requests.push([input, init])
    return new Response(
      '<script>window.__DSH_BOOT__ = ' + JSON.stringify(host) + '</script>',
      { status: 200, headers: { 'content-type': 'text/html', 'x-dsh-host-bridge': '1' } },
    )
  })

  assert.equal(requests.length, 1)
  assert.equal(requests[0][0], '/__dsh_boot')
  assert.equal(requests[0][1].credentials, 'same-origin')
  assert.deepEqual(manifest.entries.map(entry => entry.id), ['@deepseek-ai/dsh-client-connection', DESKTOP_LAYOUT_ID, 'conversation'])
  assert.equal(manifest.entries[0].url, '/plugins/@dsh-mobile/ui-layout-mobile/connection.js?rev=0.1.23')
  assert.equal(manifest.entries[0].rev, '0.1.23')
})

test('marks and clears the explicit same-origin Host bridge capability', () => {
  setSameOriginHostBridgeCapability(true)
  assert.deepEqual(globalThis[DSH_HOST_BRIDGE_CAPABILITY], { loopback: true })
  setSameOriginHostBridgeCapability(false)
  assert.equal(globalThis[DSH_HOST_BRIDGE_CAPABILITY], undefined)
})

test('reports an unavailable same-origin host without booting a blank shell', async () => {
  const manifest = await loadSameOriginMobileBootManifest(async () => new Response('', { status: 404 }))
  assert.equal(manifest, null)
})

test('ignores a static SPA fallback that is not an operator Host bridge', async () => {
  const manifest = await loadSameOriginMobileBootManifest(async () => new Response(
    '<html><div id="root"></div></html>',
    { status: 200, headers: { 'content-type': 'text/html' } },
  ))
  assert.equal(manifest, null)
})

test('fails loud when the host desktop layout seam is absent or duplicated', () => {
  assert.throws(
    () => adaptBootManifestForMobile({ rev: 'x', entries: [] }),
    /expected exactly one desktop layout entry, found 0/,
  )
  const desktop = { id: '@deepseek-ai/dsh-client-ui-layout', url: '/x', rev: 'x', inject: [] }
  assert.throws(
    () => adaptBootManifestForMobile({ rev: 'x', entries: [desktop, desktop] }),
    /expected exactly one desktop layout entry, found 2/,
  )
})

test('cached boot manifest round-trips by Host Identity', () => {
  const storage = new Map()
  const adapter = {
    getItem(key) { return storage.get(key) ?? null },
    setItem(key, value) { storage.set(key, value) },
  }
  const host = {
    rev: 'host-rev',
    entries: [{ id: '@deepseek-ai/dsh-client-ui-layout', url: '/plugins/desktop-layout.js', rev: 'desktop', inject: [] }],
  }
  writeCachedBootManifest('host-a', host, adapter)
  assert.deepEqual(readCachedBootManifest('host-a', adapter), host)
  assert.equal(readCachedBootManifest('host-b', adapter), undefined)
})

test('cache-only localization fails instead of fetching on a miss', async () => {
  const cache = createMemoryPluginCache()
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
    /plugin cache miss: @deepseek-ai\/dsh-client-ui-layout|plugin cache miss/,
  )
  assert.equal(loads, 0)
})

test('plugin bundle cache is isolated per Host Identity', async () => {
  const first = createMemoryPluginCache('host-a')
  const second = createMemoryPluginCache('host-b')
  await first.write('plugin-a', '1', 'from-a')
  assert.equal(await first.read('plugin-a', '1'), 'from-a')
  assert.equal(await second.read('plugin-a', '1'), undefined)
})

/** Storage fake with a hard byte budget; setItem throws QuotaExceededError past it. */
function quotaStorage(limit) {
  const map = new Map()
  const used = () => [...map.values()].reduce((sum, v) => sum + v.length, 0)
  return {
    map,
    get length() { return map.size },
    key(index) { return [...map.keys()][index] ?? null },
    getItem(key) { return map.get(key) ?? null },
    removeItem(key) { map.delete(key) },
    setItem(key, value) {
      if (used() + value.length > limit) {
        const error = new Error('quota exceeded')
        error.name = 'QuotaExceededError'
        throw error
      }
      map.set(key, value)
    },
  }
}

test('boot manifest write sheds cached bundles when quota is exhausted', () => {
  const storage = quotaStorage(900)
  storage.setItem('dsh-mobile:plugin:big-blob', 'p'.repeat(800))
  storage.setItem('dsh-mobile:profile-vault', 'secret')
  const host = {
    rev: 'host-rev',
    entries: [{ id: '@deepseek-ai/dsh-client-ui-layout', url: '/plugins/desktop-layout.js', rev: 'desktop', inject: [] }],
  }
  const raw = JSON.stringify(host)
  assert.ok(raw.length > 100)
  writeCachedBootManifest('host-a', host, storage)
  assert.equal(storage.map.get('dsh-mobile:plugin:big-blob'), undefined)
  assert.equal(storage.map.get('dsh-mobile:profile-vault'), 'secret')
  assert.deepEqual(readCachedBootManifest('host-a', storage), host)
  assert.deepEqual(readCachedBootManifest('last', storage), host)
})

test('plugin bundle write sheds other cached entries when quota is exhausted', async (t) => {
  if (typeof CompressionStream === 'undefined') { t.skip('no CompressionStream in this runtime'); return }
  const storage = quotaStorage(700)
  storage.setItem('dsh-mobile:plugin:old', 'o'.repeat(600))
  const cache = createLocalStoragePluginCache(storage, 'host-a')
  // Incompressible payload so compression cannot dodge the eviction path.
  const source = Array.from({ length: 1200 }, (_, i) => String.fromCharCode(0x21 + ((i * 7919) % 0x5e))).join('')
  await cache.write('plugin-new', '1', source)
  assert.equal(await cache.read('plugin-new', '1'), source)
  assert.equal(storage.map.get('dsh-mobile:plugin:old'), undefined)
})

test('compressible bundles avoid eviction entirely', async (t) => {
  if (typeof CompressionStream === 'undefined') { t.skip('no CompressionStream in this runtime'); return }
  const storage = quotaStorage(700)
  storage.setItem('dsh-mobile:plugin:old', 'o'.repeat(600))
  const cache = createLocalStoragePluginCache(storage, 'host-a')
  await cache.write('plugin-new', '1', 'n'.repeat(1200))
  assert.equal(await cache.read('plugin-new', '1'), 'n'.repeat(1200))
  assert.equal(storage.map.get('dsh-mobile:plugin:old'), 'o'.repeat(600), 'compressed write fits without shedding')
})

test('plugin caches store bundles gzip-compressed and read both forms', async (t) => {
  if (typeof CompressionStream === 'undefined') { t.skip('no CompressionStream in this runtime'); return }
  const storage = quotaStorage(5 * 1024 * 1024)
  const cache = createLocalStoragePluginCache(storage, 'host-a')
  const source = 'export const bundle = ' + JSON.stringify('js '.repeat(5000))
  await cache.write('@x/plugin', 'rev1', source)
  const raw = storage.map.get('dsh-mobile:plugin:host-a:@x/plugin:rev1')
  assert.ok(raw.startsWith('gz1:'), 'stored value carries the gzip prefix')
  assert.ok(raw.length < source.length / 2, 'compressed value shrinks the payload')
  assert.equal(await cache.read('@x/plugin', 'rev1'), source, 'reads decompress transparently')
  storage.map.set('dsh-mobile:plugin:host-a:@x/plugin:legacy', 'plain source')
  assert.equal(await cache.read('@x/plugin', 'legacy'), 'plain source', 'legacy plaintext entries still read')
})

test('plugin bundle write never sheds history caches; shed victims are plugins only', async (t) => {
  if (typeof CompressionStream === 'undefined') { t.skip('no CompressionStream in this runtime'); return }
  const storage = quotaStorage(1400)
  storage.setItem('dsh-mobile:history:session-a', 'h'.repeat(900))
  const cache = createLocalStoragePluginCache(storage, 'host-a')
  storage.setItem('dsh-mobile:plugin:host-b:@x/old:1', 'o'.repeat(300))
  await cache.write('@x/new', '1', 'n'.repeat(240))
  assert.equal(storage.map.get('dsh-mobile:history:session-a'), 'h'.repeat(900), 'history survives plugin quota pressure')
  assert.equal(await cache.read('@x/new', '1'), 'n'.repeat(240))
})

test('hydrate-localize fails loud on any missing bundle (every entry is booted eagerly)', async () => {
  const memory = createMemoryPluginCache('host-a')
  const manifest = {
    rev: 'host-rev',
    entries: [
      { id: '@deepseek-ai/dsh-cordis-client-runner', url: '/plugins/@deepseek-ai/dsh-cordis-client-runner/client.js?rev=r1', rev: 'r1' },
      { id: 'dsh-codex-sidebar', url: '/plugins/dsh-codex-sidebar/client.js?rev=e1', rev: 'e1' },
    ],
  }
  await assert.rejects(
    localizePluginBundles(manifest, {
      load: async () => { throw new Error('must not fetch during hydrate') },
      createUrl: (_source, id) => 'blob:' + id,
      cache: memory,
      cacheOnly: true,
    }),
    /plugin cache miss: @deepseek-ai\/dsh-cordis-client-runner/,
  )
})

test('legacy plaintext entries are rewritten compressed on read', async (t) => {
  if (typeof CompressionStream === 'undefined') { t.skip('no CompressionStream in this runtime'); return }
  const storage = quotaStorage(5 * 1024 * 1024)
  storage.map.set('dsh-mobile:plugin:host-a:@x/plugin:r1', 'plain source '.repeat(2000))
  const cache = createLocalStoragePluginCache(storage, 'host-a')
  assert.equal(await cache.read('@x/plugin', 'r1'), 'plain source '.repeat(2000))
  await new Promise(resolve => setTimeout(resolve, 20))
  const raw = storage.map.get('dsh-mobile:plugin:host-a:@x/plugin:r1')
  assert.ok(raw.startsWith('gz1:'), 'read-through migration compresses the entry')
  assert.ok(raw.length < 4000)
})

test('boot always keeps the official runtime and never inserts session hydration', () => {
  const runtime = { id: RUNTIME_ID, url: '/plugins/runtime.js', rev: 'official-runtime', inject: [], immediately: true }
  const layout = {
    id: DESKTOP_LAYOUT_ID, url: '/plugins/layout.js', rev: 'layout',
    inject: ['@deepseek-ai/dsh-client-ui-renderer', '@deepseek-ai/dsh-client-ui-session', '@deepseek-ai/dsh-client-ui-theme'],
  }
  const host = { rev: 'host', entries: [runtime, layout] }
  const selected = selectResponsiveBootManifest(host, { viewportWidth: 390 })
  assert.equal(selected.layout, 'narrow')
  assert.deepEqual(selected.manifest.entries.find(entry => entry.id === RUNTIME_ID), runtime)
  assert.ok(!JSON.stringify(selected.manifest).includes('session-hydration'))
  const official = selectResponsiveBootManifest(host, { viewportWidth: 1280 })
  assert.equal(official.layout, 'official')
  assert.deepEqual(official.manifest.entries.find(entry => entry.id === RUNTIME_ID), runtime)
})
