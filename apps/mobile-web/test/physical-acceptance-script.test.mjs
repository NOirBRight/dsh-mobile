import test from 'node:test'
import assert from 'node:assert/strict'
import { parseAdbDevices, parsePackageVersion, physicalDeviceFacts } from '../scripts/run-physical-acceptance.mjs'

test('physical acceptance selects only authorized adb devices', () => {
  const rows = parseAdbDevices('List of devices attached\nABC123 device product:p model:Pixel_8 device:husky transport_id:1\nEMU offline transport_id:2\n')
  assert.deepEqual(rows, [{ serial: 'ABC123', state: 'device', model: 'Pixel_8' }, { serial: 'EMU', state: 'offline', model: undefined }])
})

test('physical device facts reject emulators and derive CSS width', () => {
  assert.deepEqual(physicalDeviceFacts({ qemu: '0', sdk: '36', model: 'OnePlus_13', size: 'Physical size: 1440x3168', density: 'Physical density: 560' }), {
    model: 'OnePlus_13', sdk: 36, widthPx: 1440, densityDpi: 560, approximateCssWidth: 411, physical: true,
  })
  assert.equal(physicalDeviceFacts({ qemu: '1', sdk: '35', model: 'sdk_gphone', size: '1080x2400', density: '420' }).physical, false)
})

test('installed package metadata must match the campaign APK', () => {
  assert.deepEqual(parsePackageVersion('versionCode=11 minSdk=26 targetSdk=36\nversionName=1.1.1-test.20260824.9\n'), {
    versionCode: 11, versionName: '1.1.1-test.20260824.9',
  })
})
