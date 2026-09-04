import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareDshClientBoot, resetDshClientBoot } from '../src/dsh-boot.ts'

test('prepareDshClientBoot installs the queue and parser preloads before create', async () => {
  const manifest = { rev: 'host', entries: [
    { id: '@deepseek-ai/dsh-client-modules', url: 'blob:modules', rev: 'm', inject: [] },
  ] }
  const loaded = []
  await prepareDshClientBoot(manifest, async (_url, id) => {
    loaded.push(id)
    const loader = globalThis.__ModuleLoader__
    loader.load({
      id,
      factory: () => ({
        apply() {},
        createClientModuleSystem: (facade, bootstrap, options) => ({ facade, bootstrap, options }),
      }),
    })
  })
  assert.deepEqual(loaded, ['@deepseek-ai/dsh-client-modules'])
  assert.deepEqual(globalThis.__ModuleLoader__.pendingQueue.map(row => row.id), loaded)
  const result = globalThis.__ModuleLoader__.create({ boot: true })
  assert.equal(result.bootstrap.id, '@deepseek-ai/dsh-client-modules')
  assert.deepEqual(result.options, { boot: true })
  assert.deepEqual(globalThis.__ModuleLoader__.pendingQueue.map(row => row.id), [])
  resetDshClientBoot()
})

test('resetDshClientBoot deletes ModuleLoader and DSH_MODULES and is a no-op when they are absent', () => {
  const win = globalThis
  delete win.__ModuleLoader__
  delete win.__DSH_MODULES__
  resetDshClientBoot()
  assert.equal(win.__ModuleLoader__, undefined)
  assert.equal(win.__DSH_MODULES__, undefined)
  win.__ModuleLoader__ = { load() {} }
  win.__DSH_MODULES__ = { version: 'client' }
  resetDshClientBoot()
  assert.equal('__ModuleLoader__' in win, false)
  assert.equal('__DSH_MODULES__' in win, false)
})

test('resetDshClientBoot removes plugin-owned styles before another Host graph materializes', () => {
  const originalDocument = globalThis.document
  const removed = []
  const pluginStyles = [
    { remove() { removed.push('old-layout') } },
    { remove() { removed.push('old-theme') } },
  ]
  globalThis.document = {
    querySelectorAll(selector) {
      assert.equal(selector, 'style[data-plugin]')
      return pluginStyles
    },
  }
  try {
    resetDshClientBoot()
    assert.deepEqual(removed, ['old-layout', 'old-theme'])
  } finally {
    if (originalDocument === undefined) delete globalThis.document
    else globalThis.document = originalDocument
  }
})
