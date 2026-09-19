import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { reloadStalledBoot } from '../src/boot-recovery.ts'

test('only stalled boot recovery reloads; healthy profile switching stays resident', () => {
  const previous = globalThis.window
  let reloads = 0
  globalThis.window = { location: { reload() { reloads++ } } }
  try {
    assert.equal(reloadStalledBoot(false, false), false)
    assert.equal(reloads, 0)
    assert.equal(reloadStalledBoot(true, false), true)
    assert.equal(reloadStalledBoot(false, true), true)
    assert.equal(reloads, 2)
  } finally {
    if (previous === undefined) delete globalThis.window
    else globalThis.window = previous
  }
})

// Execute the production boot owner with a stalled Host entry. No browser or
// real timers: the recovery button must remain outside the Host-owned root.
test('a stalled boot keeps a device-menu escape outside the Host root', async () => {
  const source = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
  const boot = source.slice(source.indexOf('async function bootDshShell('), source.indexOf('\nfunction validOfferUrl'))
  const callbacks = []
  const buttons = []
  let opened = 0
  let finish
  const pending = new Promise(resolve => { finish = resolve })
  const run = new Function('document', 'window', 'AppWebEntry', 'runDshClient', 'openBootProfileMenu', `
    let shellPaintDepth = 0, webEntry = null, bootRecoveryRequested = false
    const el = { replaceChildren() {} }
    const concealShellNativeBridges = () => {}
    const installMobileActionStyles = () => {}
    const inspectChromeAnchors = () => ({ ok: true })
    ${stripTypeScriptTypes(boot)}
    return { bootDshShell, recovering: () => bootRecoveryRequested, depth: () => shellPaintDepth }
  `)({
    body: { append(button) { buttons.push(button) } },
    createElement() { return { dataset: {}, style: {}, remove() { buttons.splice(buttons.indexOf(this), 1) } } },
  }, {
    setTimeout(callback) { callbacks.push(callback); return callbacks.length },
    clearTimeout() {},
  }, class {}, () => pending, () => { opened++ })
  const task = run.bootDshShell(null)
  await Promise.resolve()
  callbacks[0]()
  assert.equal(run.depth(), 1)
  assert.equal(buttons[0].textContent, '连接选项')
  buttons[0].onclick()
  assert.equal(opened, 1)
  assert.equal(run.recovering(), true)
  finish()
  await task
  assert.equal(buttons.length, 0)
  assert.equal(run.depth(), 0)
  assert.equal(run.recovering(), false, 'a completed graph must restore healthy resident switching')
  assert.match(source, /async function stageHostSwitch[\s\S]*?reloadStalledBoot\(shellRootIsPainting\(\), bootRecoveryRequested\)/)
})
