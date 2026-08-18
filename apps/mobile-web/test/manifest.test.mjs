import test from 'node:test'
import assert from 'node:assert/strict'
import { adaptBootManifestForMobile, DESKTOP_LAYOUT_ID, layoutCompatibilityMessage, loadSameOriginMobileBootManifest, localizePluginBundles, MOBILE_LAYOUT_ID, NARROW_LAYOUT_BREAKPOINT, officialNarrowContractAvailable, PLUGIN_LOAD_CONCURRENCY, readViewportWidth, selectResponsiveBootManifest } from '../src/manifest.ts'

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
        inject: ['@deepseek-ai/dsh-client-runtime', '@deepseek-ai/dsh-client-ui-theme'],
      },
      { id: 'after', url: '/plugins/after.js', rev: 'b', inject: [] },
    ],
  }
  const snapshot = structuredClone(host)

  const mobile = adaptBootManifestForMobile(host)

  assert.deepEqual(host, snapshot)
  assert.equal(mobile.rev, 'host-rev+mobile-layout-0.1.0')
  assert.deepEqual(mobile.entries.map(entry => entry.id), ['before', MOBILE_LAYOUT_ID, 'after'])
  assert.deepEqual(mobile.entries[1], {
    id: MOBILE_LAYOUT_ID,
    url: '/plugins/@dsh-mobile/ui-layout-mobile/client.js?rev=0.1.0',
    rev: '0.1.0',
    inject: ['@deepseek-ai/dsh-client-runtime', '@deepseek-ai/dsh-client-ui-theme'],
  })
})


test('readViewportWidth trusts a CSS-narrow viewport over an inflated JS width', () => {
  assert.equal(readViewportWidth({ matches: true, measured: 1080 }), NARROW_LAYOUT_BREAKPOINT - 1)
  assert.equal(readViewportWidth({ matches: false, measured: 900 }), 900)
  assert.equal(readViewportWidth({ matches: true, measured: 360 }), 360)
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
  assert.deepEqual(narrow.manifest.entries.map(entry => entry.id), [MOBILE_LAYOUT_ID, 'leaf'])
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
    inject: ['@deepseek-ai/dsh-client-runtime', '@deepseek-ai/dsh-client-ui-theme'],
  }
  assert.equal(officialNarrowContractAvailable({ rev: 'host', entries: [official] }), true)
  assert.equal(officialNarrowContractAvailable({ rev: 'host', entries: [{ ...official, inject: [] }] }), false)
  assert.equal(layoutCompatibilityMessage('compatible'), null)
  assert.match(layoutCompatibilityMessage('revision-mismatch'), /布局版本/)
  assert.match(layoutCompatibilityMessage('missing-contract'), /官方布局/)
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

test('localizes host plugin scripts while keeping the packaged mobile layout', async () => {
  const manifest = {
    rev: 'mobile',
    entries: [
      { id: 'runtime', url: '/plugins/runtime/client.js?rev=a', rev: 'a', inject: [] },
      { id: MOBILE_LAYOUT_ID, url: '/plugins/@dsh-mobile/ui-layout-mobile/client.js?rev=0.1.0', rev: '0.1.0', inject: [] },
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
  assert.equal(localized.entries[2].url, 'blob:test/leaf/32')
  assert.deepEqual(manifest.entries.map(entry => entry.url), [
    '/plugins/runtime/client.js?rev=a',
    '/plugins/@dsh-mobile/ui-layout-mobile/client.js?rev=0.1.0',
    '/plugins/leaf/client.js?rev=b',
  ])
})

test('localizes host plugins with bounded in-flight tunnel loads', async () => {
  let inFlight = 0
  let maxInFlight = 0
  const manifest = {
    rev: 'r',
    entries: [1, 2, 3, 4].map(i => ({ id: 'p' + i, url: '/plugins/p' + i + '.js', rev: '1', inject: [] })),
  }
  await localizePluginBundles(manifest, {
    load: async url => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise(resolve => setTimeout(resolve, 20))
      inFlight -= 1
      return '// ' + url
    },
    createUrl: (_source, id) => id,
  })
  assert.ok(maxInFlight <= PLUGIN_LOAD_CONCURRENCY)
  assert.equal(maxInFlight, PLUGIN_LOAD_CONCURRENCY)
})

test('loads a validated raw same-origin manifest before responsive root selection', async () => {
  const host = {
    rev: 'host-direct',
    entries: [
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
  assert.deepEqual(manifest.entries.map(entry => entry.id), [DESKTOP_LAYOUT_ID, 'conversation'])
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
