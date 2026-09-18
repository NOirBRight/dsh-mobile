import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { attachDarwinDesktop, isPrimitivesIndexModule, patchPrimitivesIndex } from '../src/vite-darwin-desktop.ts'
import { isDarwinDesktop } from '../src/darwin-desktop.ts'

const DARWIN = new URL('../src/darwin-desktop.ts', import.meta.url)
const VITE = new URL('../vite.config.ts', import.meta.url)
const ALPHA4_INDEX = new URL('../../../.dsh-upstream/packages/client/ui-primitives/src/index.ts', import.meta.url)
const ALPHA2_SIDEBAR = resolve(
  homedir(),
  '.local/opt/dsh-staging/dsh-v0.1.6-alpha.2-src/packages/client/ui-sidebar/src/client/SidebarRoot.tsx',
)

test('0.1.5 primitives omit isDarwinDesktop that alpha.2 SidebarRoot calls', async (t) => {
  const index = await readFile(ALPHA4_INDEX, 'utf8')
  assert.doesNotMatch(index, /isDarwinDesktop/)
  if (!existsSync(ALPHA2_SIDEBAR)) {
    t.skip('alpha.2 staging tree is an optional read-only seam')
    return
  }
  const sidebar = await readFile(ALPHA2_SIDEBAR, 'utf8')
  assert.match(sidebar, /isDarwinDesktop/)
})

test('Vite wires the darwin-desktop patch onto the seeded primitives barrel', async () => {
  const source = await readFile(VITE, 'utf8')
  assert.match(source, /attachDarwinDesktop\(src\('\.\/src\/darwin-desktop\.ts'\)\)/)
})

test('patch appends isDarwinDesktop onto an older primitives barrel', () => {
  const extra = fileURLToPath(DARWIN)
  const patched = patchPrimitivesIndex('export { Tooltip } from \'./Tooltip.tsx\'\n', extra)
  assert.ok(patched !== null)
  assert.match(patched, /isDarwinDesktop/)
  assert.ok(patched.includes(extra))
  assert.equal(patchPrimitivesIndex('export { isDarwinDesktop } from \'./darwin-desktop.ts\'\n', extra), null)
})

test('transform only rewrites the primitives public barrel', () => {
  const extra = fileURLToPath(DARWIN)
  const plugin = attachDarwinDesktop(extra)
  assert.equal(typeof plugin.transform, 'function')
  const transform = plugin.transform
  assert.equal(isPrimitivesIndexModule('/tmp/ui-primitives/src/icons/index.tsx'), false)
  const miss = transform.call(plugin, 'export { Tooltip }\n', '/x/ui-primitives/src/icons/index.tsx')
  assert.equal(miss, undefined)
  const hit = transform.call(plugin, 'export { Tooltip }\n', '/x/ui-primitives/src/index.ts?v=1')
  assert.ok(hit !== undefined && typeof hit === 'object' && 'code' in hit)
  assert.match(hit.code, /isDarwinDesktop/)
})

test('seeded isDarwinDesktop is false on a plain web document', () => {
  const previous = globalThis.document
  globalThis.document = {
    documentElement: { dataset: {} },
  }
  try {
    assert.equal(isDarwinDesktop(), false)
    globalThis.document.documentElement.dataset.platform = 'darwin'
    assert.equal(isDarwinDesktop(), true)
  } finally {
    if (previous === undefined) delete globalThis.document
    else globalThis.document = previous
  }
})
