import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DESKTOP_LAYOUT_ID,
  INTERACTION_OPERATIONS_ID,
  MOBILE_LAYOUT_ID,
  RUNTIME_ID,
  selectResponsiveBootManifest,
} from '../apps/mobile-web/src/manifest.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const runtime = {
  id: RUNTIME_ID, url: '/plugins/runtime.js', rev: 'official-runtime',
  inject: ['@deepseek-ai/dsh-client-runtime'], immediately: true,
}
const layout = {
  id: DESKTOP_LAYOUT_ID, url: '/plugins/layout.js', rev: 'layout',
  inject: ['@deepseek-ai/dsh-client-runtime', '@deepseek-ai/dsh-client-ui-theme'],
}
const host = { rev: 'official', entries: [runtime, layout] }

const core = selectResponsiveBootManifest(host, { viewportWidth: 390 })
assert.equal(core.layout, 'narrow')
assert.equal(core.compatibility, 'compatible')
assert.ok(core.manifest.entries.some(entry => entry.id === MOBILE_LAYOUT_ID))
assert.ok(core.manifest.entries.some(entry => entry.id === INTERACTION_OPERATIONS_ID))
assert.ok(core.manifest.entries.some(entry => entry.id === RUNTIME_ID && entry.url === '/plugins/runtime.js'))
assert.ok(!JSON.stringify(core.manifest).includes('session-hydration'))

const official = selectResponsiveBootManifest(host, { viewportWidth: 1280 })
assert.equal(official.layout, 'official')
assert.equal(official.manifest.entries.find(entry => entry.id === RUNTIME_ID)?.url, '/plugins/runtime.js')
assert.ok(official.manifest.entries.some(entry => entry.id === INTERACTION_OPERATIONS_ID))
assert.ok(!JSON.stringify(official.manifest).includes('session-hydration'))

const pairingPackage = JSON.parse(await readFile(resolve(root, 'plugins/pairing/package.json'), 'utf8'))
const pairingDependencies = { ...pairingPackage.dependencies, ...pairingPackage.peerDependencies }
assert.equal(pairingDependencies['@dsh-mobile/session-hydration'], undefined)
assert.equal(pairingDependencies['@deepseek-ai/dsh-client-runtime'], undefined)

console.log(JSON.stringify({
  alwaysCore: true,
  noHydrationInBoot: true,
  pairingCoreIndependent: true,
}, null, 2))
