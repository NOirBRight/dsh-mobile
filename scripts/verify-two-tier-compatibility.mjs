import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DESKTOP_LAYOUT_ID,
  MOBILE_HYDRATION_ID,
  RUNTIME_ID,
  SUPPORTED_OFFICIAL_RUNTIME_REVISIONS,
  selectSessionEnhancement,
} from '../apps/mobile-web/src/manifest.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const official = process.env.DSH_OFFICIAL ?? resolve(root, '../deepseek-harness')
const downstream = process.env.DSH_DOWNSTREAM ?? resolve(root, '../dsh-wt-02')
const metadata = JSON.parse(await readFile(resolve(root, 'patches/dsh-runtime-session-hydration.json'), 'utf8'))
const patch = await readFile(resolve(root, 'patches/dsh-runtime-session-hydration.patch'), 'utf8')
const officialBundle = await readFile(resolve(official, 'packages/client/runtime/lib/client.js'))
const downstreamBundle = await readFile(resolve(downstream, 'packages/client/runtime/lib/client.js'))
const sha1 = bytes => createHash('sha1').update(bytes).digest('hex').slice(0, 12)

assert.equal(sha1(officialBundle), metadata.upstream.runtimeRevision, 'official runtime revision drifted')
assert.equal(sha1(downstreamBundle), metadata.downstream.runtimeRevision, 'downstream runtime revision drifted')
assert.deepEqual(SUPPORTED_OFFICIAL_RUNTIME_REVISIONS, [metadata.upstream.runtimeRevision])
assert.ok(!officialBundle.includes(Buffer.from('dsh-mobile:history')), 'official bundle still contains mobile storage policy')
assert.ok(!officialBundle.includes(Buffer.from('sessionHydration')), 'official bundle is not pristine')
assert.ok(downstreamBundle.includes(Buffer.from('sessionHydration')), 'downstream bundle lacks the optional seam')
assert.ok(!downstreamBundle.includes(Buffer.from('dsh-mobile:history')), 'downstream seam owns mobile storage policy')
for (const forbidden of ['dsh-mobile:', 'localStorage', 'document.documentElement', 'StatsLine', 'style-refresh']) {
  assert.ok(!patch.includes(forbidden), 'downstream patch contains unrelated/mobile policy: ' + forbidden)
}

const runtime = {
  id: RUNTIME_ID, url: '/plugins/runtime.js', rev: metadata.upstream.runtimeRevision,
  inject: [], immediately: true,
}
const layout = { id: DESKTOP_LAYOUT_ID, url: '/plugins/layout.js', rev: 'layout', inject: [] }
const core = selectSessionEnhancement({ rev: 'official', entries: [runtime, layout] }, { preference: 'compatible' })
assert.equal(core.status, 'core')
assert.equal(core.manifest.entries[0], runtime, 'Core changed the official runtime entry')
assert.ok(!core.manifest.entries.some(entry => entry.id === MOBILE_HYDRATION_ID))
const upgrade = selectSessionEnhancement({
  rev: 'official-update', entries: [{ ...runtime, rev: 'unverified-update' }, layout],
}, { preference: 'enhanced' })
assert.equal(upgrade.status, 'incompatible')
assert.ok(!upgrade.manifest.entries.some(entry => entry.id === MOBILE_HYDRATION_ID))

const pairingPackage = JSON.parse(await readFile(resolve(root, 'plugins/pairing/package.json'), 'utf8'))
const pairingDependencies = { ...pairingPackage.dependencies, ...pairingPackage.peerDependencies }
assert.equal(pairingDependencies['@dsh-mobile/session-hydration'], undefined)
assert.equal(pairingDependencies['@deepseek-ai/dsh-client-runtime'], undefined)

console.log(JSON.stringify({
  officialRuntimeRevision: sha1(officialBundle),
  downstreamRuntimeRevision: sha1(downstreamBundle),
  coreRuntimeUntouched: true,
  unknownUpgradeFallback: true,
  downstreamPatchProductNeutral: true,
  pairingCoreIndependent: true,
}, null, 2))
