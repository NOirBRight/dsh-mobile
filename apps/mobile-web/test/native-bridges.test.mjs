import test from 'node:test'
import assert from 'node:assert/strict'
import { Capacitor, registerPlugin } from '@capacitor/core'
import { claimShellNativeBridges, concealShellNativeBridges, installSystemBarThemeSync } from '../src/native-bridges.ts'

test('claiming native bridges removes them from the public Capacitor table', () => {
  registerPlugin('DshSecureVault')
  assert.ok('DshSecureVault' in Capacitor.Plugins)
  const bridges = claimShellNativeBridges(true)
  assert.ok(bridges.vault)
  assert.ok(bridges.systemBars)
  assert.equal('DshSecureVault' in Capacitor.Plugins, false)
  assert.equal('DshCameraPermission' in Capacitor.Plugins, false)
  assert.throws(() => Capacitor.registerPlugin('DshSecureVault'), /reserved for the App Shell/)
})

test('non-native claim does not hand out a vault and refuses the camera', async () => {
  const bridges = claimShellNativeBridges(false)
  assert.equal(bridges.vault, null)
  assert.equal(bridges.systemBars, null)
  await assert.rejects(bridges.ensureCamera(), /reserved for the App Shell/)
})

test('conceal can be repeated after a later plugin import', () => {
  registerPlugin('CapacitorBarcodeScanner')
  concealShellNativeBridges()
  assert.equal('CapacitorBarcodeScanner' in Capacitor.Plugins, false)
  assert.throws(() => Capacitor.registerPlugin('App'), /reserved for the App Shell/)
})

test('system bars follow light/dark body theme changes without exposing the plugin', async () => {
  const originalDocument = globalThis.document
  const originalObserver = globalThis.MutationObserver
  let dark = false
  let notify
  globalThis.document = { body: { hasAttribute: () => dark } }
  globalThis.MutationObserver = class {
    constructor(callback) { notify = callback; this.active = true }
    observe() {}
    disconnect() { this.active = false }
  }
  const calls = []
  try {
    const dispose = installSystemBarThemeSync({ setAppearance: async options => { calls.push(options.dark) } })
    await Promise.resolve()
    assert.deepEqual(calls, [false])
    dark = true
    notify()
    await Promise.resolve()
    assert.deepEqual(calls, [false, true])
    dispose()
    assert.deepEqual(calls, [false, true])
  } finally {
    if (originalDocument === undefined) delete globalThis.document
    else globalThis.document = originalDocument
    if (originalObserver === undefined) delete globalThis.MutationObserver
    else globalThis.MutationObserver = originalObserver
  }
})
