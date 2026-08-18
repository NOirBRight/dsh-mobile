import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('bootstrap claims native bridges instead of leaving Capacitor.Plugins public', async () => {
  const source = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
  assert.match(source, /claimShellNativeBridges/)
  assert.match(source, /concealShellNativeBridges/)
  assert.doesNotMatch(source, /registerPlugin/)
})

test('shell-owned plugins are registered before Capacitor creates the Bridge', async () => {
  const source = await readFile(new URL('../android/app/src/main/java/top/noirbright/dshmobile/MainActivity.java', import.meta.url), 'utf8')
  assert.ok(source.includes('registerPlugin(SecureVaultPlugin.class)'))
  assert.ok(source.indexOf('registerPlugin(SecureVaultPlugin.class)') < source.indexOf('super.onCreate(savedInstanceState)'))
  assert.ok(source.includes('registerPlugin(CameraPermissionPlugin.class)'))
  assert.ok(source.indexOf('registerPlugin(CameraPermissionPlugin.class)') < source.indexOf('super.onCreate(savedInstanceState)'))
})

test('camera permission bridge declares and requests the Android camera permission', async () => {
  const source = await readFile(new URL('../android/app/src/main/java/top/noirbright/dshmobile/CameraPermissionPlugin.java', import.meta.url), 'utf8')
  assert.match(source, /Manifest\.permission\.CAMERA/)
  assert.match(source, /requestPermissionForAlias\("camera"/)
  assert.match(source, /@PermissionCallback/)
})
