/**
 * Capacitor concatenates every file under the web root's plugins/ directory into
 * one document-start script as Cordova plugin JS — before any shell code runs,
 * so window.__ModuleLoader__ does not exist and each bundled
 * __ModuleLoader__.load(...) call throws
 * "Cannot read properties of undefined (reading 'load')".
 * These tests pin the two halves of staying out of that directory: the shell
 * asks for its own bundles under the Android base, and the Android packaging
 * step leaves nothing behind under the swept one.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { ANDROID_LOCAL_PLUGIN_BASE, CONNECTION_ID, WEB_LOCAL_PLUGIN_BASE, isPackagedShellPluginUrl, selectResponsiveBootManifest } from '../src/manifest.ts'
import { packageAndroidLayout } from '../scripts/package-android-layout.mjs'

const hostManifest = {
  rev: 'host-rev',
  entries: [
    { id: '@deepseek-ai/dsh-cordis-client-runner', url: '/plugins/runner/client.js?rev=r', rev: 'r', inject: [] },
    { id: '@deepseek-ai/dsh-client-ui-layout', url: '/plugins/layout/client.js?rev=l', rev: 'l', inject: [] },
    { id: CONNECTION_ID, url: '/plugins/@dsh-mobile/ui-layout-mobile/connection.js?rev=0.1.23', rev: '0.1.23', inject: [] },
    { id: 'leaf', url: '/plugins/leaf/client.js?rev=x', rev: 'x', inject: [] },
  ],
}

test('the Android base keeps every shell-owned bundle out of the Capacitor sweep path', () => {
  const selection = selectResponsiveBootManifest(hostManifest, {
    viewportWidth: 400,
    localPluginBase: ANDROID_LOCAL_PLUGIN_BASE,
  })
  const shellOwned = selection.manifest.entries
    .filter(entry => entry.id.startsWith('@dsh-mobile/') || entry.url.includes('/@dsh-mobile/'))
  assert.equal(shellOwned.length, 3, 'mobile layout, its Host bridge, and interaction operations')
  for (const entry of shellOwned) {
    assert.ok(entry.url.startsWith(ANDROID_LOCAL_PLUGIN_BASE + '/'), entry.url)
    assert.ok(!entry.url.startsWith('/plugins/'), entry.id + ' must not address the swept directory: ' + entry.url)
  }
  const layoutEntry = selection.manifest.entries.find(entry => entry.id === '@dsh-mobile/ui-layout-mobile')
  assert.ok(isPackagedShellPluginUrl(layoutEntry.url), layoutEntry.url)
  const hostEntries = selection.manifest.entries.filter(entry => entry.url.startsWith(WEB_LOCAL_PLUGIN_BASE + '/'))
  assert.deepEqual(hostEntries.map(entry => entry.id), [
    '@deepseek-ai/dsh-cordis-client-runner',
    'leaf',
  ], 'Host plugins keep the Host path and nothing else uses it')
})

test('both bases are recognized as shell-owned, and Host plugins are not', () => {
  assert.equal(isPackagedShellPluginUrl('/mobile-plugins/@dsh-mobile/ui-layout-mobile/client.js'), true)
  assert.equal(isPackagedShellPluginUrl('/mobile-plugins/@dsh-mobile/ui-layout-mobile/connection.js?rev=0.1.23'), true)
  assert.equal(isPackagedShellPluginUrl('/plugins/@dsh-mobile/ui-layout-mobile/client.js'), true)
  assert.equal(isPackagedShellPluginUrl('/plugins/@deepseek-ai/dsh-client-ui-layout/client.js'), false)
  assert.equal(isPackagedShellPluginUrl('/mobile-plugins/@deepseek-ai/dsh-client-ui-layout/client.js'), false)
})

test('Android packaging stages the shell bundles outside plugins/ and clears what cap copy put there', async () => {
  const appRoot = await mkdtemp(join(tmpdir(), 'dsh-android-layout-'))
  try {
    const dist = join(appRoot, 'dist/plugins/@dsh-mobile')
    const copied = join(appRoot, 'android/app/src/main/assets/public/plugins/@dsh-mobile')
    for (const relativePath of ['ui-layout-mobile/client.js', 'ui-layout-mobile/connection.js', 'interaction-operations/client.js']) {
      await mkdir(dirname(join(dist, relativePath)), { recursive: true })
      await writeFile(join(dist, relativePath), 'window.__ModuleLoader__.load({ id: ' + JSON.stringify(relativePath) + ' })')
      await mkdir(dirname(join(copied, relativePath)), { recursive: true })
      await writeFile(join(copied, relativePath), 'copied by cap sync')
    }

    await packageAndroidLayout(appRoot)

    const androidPublic = join(appRoot, 'android/app/src/main/assets/public')
    assert.equal(existsSync(join(androidPublic, 'plugins')), false, 'the Capacitor Cordova sweep path must be empty')
    assert.equal(existsSync(join(androidPublic, 'mobile-plugins/@dsh-mobile/ui-layout-mobile/client.js')), true)
    assert.equal(existsSync(join(androidPublic, 'mobile-plugins/@dsh-mobile/interaction-operations/client.js')), true)
    const staged = await readFile(join(androidPublic, 'mobile-plugins/@dsh-mobile/ui-layout-mobile/connection.js'), 'utf8')
    assert.match(staged, /__ModuleLoader__/, 'the staged file is the built bundle, not the cap copy')
  } finally {
    await rm(appRoot, { recursive: true, force: true })
  }
})

test('Android packaging refuses to delete a foreign Cordova plugin directory', async () => {
  const appRoot = await mkdtemp(join(tmpdir(), 'dsh-android-layout-'))
  try {
    const foreign = join(appRoot, 'android/app/src/main/assets/public/plugins/org.apache.cordova.device')
    await mkdir(foreign, { recursive: true })
    await writeFile(join(foreign, 'plugin.js'), '// cordova plugin')
    await assert.rejects(() => packageAndroidLayout(appRoot), /non-shell entries: org.apache.cordova.device/)
  } finally {
    await rm(appRoot, { recursive: true, force: true })
  }
})
