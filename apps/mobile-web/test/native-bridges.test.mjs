import test from 'node:test'
import assert from 'node:assert/strict'
import { Capacitor, registerPlugin } from '@capacitor/core'
import { claimShellNativeBridges, concealShellNativeBridges } from '../src/native-bridges.ts'

test('claiming native bridges removes them from the public Capacitor table', () => {
  registerPlugin('DshSecureVault')
  assert.ok('DshSecureVault' in Capacitor.Plugins)
  const bridges = claimShellNativeBridges(true)
  assert.ok(bridges.vault)
  assert.equal('DshSecureVault' in Capacitor.Plugins, false)
  assert.equal('DshCameraPermission' in Capacitor.Plugins, false)
  assert.throws(() => Capacitor.registerPlugin('DshSecureVault'), /reserved for the App Shell/)
})

test('non-native claim does not hand out a vault and refuses the camera', async () => {
  const bridges = claimShellNativeBridges(false)
  assert.equal(bridges.vault, null)
  await assert.rejects(bridges.ensureCamera(), /reserved for the App Shell/)
})

test('conceal can be repeated after a later plugin import', () => {
  registerPlugin('CapacitorBarcodeScanner')
  concealShellNativeBridges()
  assert.equal('CapacitorBarcodeScanner' in Capacitor.Plugins, false)
  assert.throws(() => Capacitor.registerPlugin('App'), /reserved for the App Shell/)
})
