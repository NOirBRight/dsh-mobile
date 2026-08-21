import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareDshClientBoot, resetDshClientBoot } from '../src/dsh-boot.ts'

test('prepareDshClientBoot installs the queue and parser preloads before create', async () => {
  const manifest = { rev: 'host', entries: [
    { id: '@deepseek-ai/dsh-client-modules', url: 'blob:modules', rev: 'm', inject: [] },
    { id: '@deepseek-ai/dsh-client-runtime', url: 'blob:runtime', rev: 'r', inject: [] },
  ] }
  const loaded = []
  await prepareDshClientBoot(manifest, async (_url, id) => {
    loaded.push(id)
    const loader = globalThis.__ModuleLoader__
    loader.load(id === '@deepseek-ai/dsh-client-modules' ? {
      id,
      factory: () => ({
        apply() {},
        createClientModuleSystem: (facade, bootstrap, options) => ({ facade, bootstrap, options }),
      }),
    } : { id, factory: () => ({ apply() {} }) })
  })
  assert.deepEqual(loaded, ['@deepseek-ai/dsh-client-modules', '@deepseek-ai/dsh-client-runtime'])
  assert.deepEqual(globalThis.__ModuleLoader__.pendingQueue.map(row => row.id), loaded)
  const result = globalThis.__ModuleLoader__.create({ boot: true })
  assert.equal(result.bootstrap.id, '@deepseek-ai/dsh-client-modules')
  assert.deepEqual(result.options, { boot: true })
  assert.deepEqual(globalThis.__ModuleLoader__.pendingQueue.map(row => row.id), ['@deepseek-ai/dsh-client-runtime'])
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
