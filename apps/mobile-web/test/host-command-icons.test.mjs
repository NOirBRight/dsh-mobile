import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { attachHostCommandIcons, isPrimitivesIconsModule, patchPrimitivesIcons } from '../src/vite-host-command-icons.ts'

const ICONS = new URL('../src/host-command-icons.tsx', import.meta.url)
const VITE = new URL('../vite.config.ts', import.meta.url)
const ALPHA4_ICONS = new URL('../../../.dsh-upstream/packages/client/ui-primitives/src/icons/index.tsx', import.meta.url)

test('Alpha.4 primitives omit the Host 0.1.6 HOST_FACES glyphs', async () => {
  const source = await readFile(ALPHA4_ICONS, 'utf8')
  assert.doesNotMatch(source, /export const IconPlanOutline14/)
  assert.doesNotMatch(source, /export const IconPaperPlaneOutline14/)
  assert.doesNotMatch(source, /export const IconCompactOutline16/)
  assert.doesNotMatch(source, /export const IconShieldOutline16/)
})

test('host-command-icons carries the 0.1.6 plan/feedback/compact/permission paths', async () => {
  const source = await readFile(ICONS, 'utf8')
  assert.match(source, /export const IconPlanOutline14/)
  assert.match(source, /M9\.56143 3\.14672V4\.24774H3\.94716/)
  assert.match(source, /export const IconPaperPlaneOutline14/)
  assert.match(source, /M11\.8249 1\.11733C12\.4401 0\.929305/)
  assert.match(source, /export const IconCompactOutline16/)
  assert.match(source, /A6\.4 6\.4 0 0 1 14\.4 8/)
  assert.match(source, /export const IconShieldOutline16/)
  assert.match(source, /M8\.20554 0\.899994L14\.7901 3\.36857/)
  assert.doesNotMatch(source, /from '@deepseek-ai\/dsh-client-ui-primitives'/)
})

test('Vite wires the Host-face patch onto the seeded primitives icons module', async () => {
  const source = await readFile(VITE, 'utf8')
  assert.match(source, /attachHostCommandIcons\(src\('\.\/src\/host-command-icons\.tsx'\)\)/)
})

test('Vite seeds alpha.2 SlotCore independently of the 0.1.5 Host compile pin', async () => {
  const vite = await readFile(VITE, 'utf8')
  assert.match(vite, /DSH_SLOTS_SEED/)
  assert.match(vite, /slotsUp\('packages\/client\/ui-slots\/src\/index\.ts'\)/)
  const seed = await readFile(new URL('../scripts/vite-with-host-seed.mjs', import.meta.url), 'utf8')
  assert.match(seed, /dsh-v0\.1\.6-alpha\.2-src/)
  assert.match(seed, /dsh-v0\.1\.5-rc\.1-183f08e9c6dd-src/)
  assert.match(seed, /DSH_SLOTS_SEED/)
})

test('patch appends Host-face exports onto an older icons barrel', () => {
  const extra = fileURLToPath(ICONS)
  const patched = patchPrimitivesIcons('export const IconGoalOutline16 = () => null\n', extra)
  assert.ok(patched !== null)
  assert.match(patched, /IconPlanOutline14/)
  assert.match(patched, /IconPaperPlaneOutline14/)
  assert.match(patched, /IconCompactOutline16/)
  assert.match(patched, /IconShieldOutline16/)
  assert.ok(patched.includes(extra))
  assert.equal(patchPrimitivesIcons('export const IconPlanOutline14 = () => null\n', extra), null)
})

test('transform only rewrites the primitives icons barrel', () => {
  const extra = fileURLToPath(ICONS)
  const plugin = attachHostCommandIcons(extra)
  assert.equal(typeof plugin.transform, 'function')
  const transform = plugin.transform
  assert.equal(isPrimitivesIconsModule('/tmp/ui-primitives/src/index.ts'), false)
  const miss = transform.call(plugin, 'export const IconGoal = () => null\n', '/x/ui-slots/src/index.ts')
  assert.equal(miss, undefined)
  const hit = transform.call(plugin, 'export const IconGoal = () => null\n', '/x/ui-primitives/src/icons/index.tsx?v=1')
  assert.ok(hit !== undefined && typeof hit === 'object' && 'code' in hit)
  assert.match(hit.code, /IconPlanOutline14/)
})
