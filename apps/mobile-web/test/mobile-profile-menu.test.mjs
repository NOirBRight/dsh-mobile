import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const sourceUrl = new URL('../src/host-profile-menu.ts', import.meta.url)

test('device panel reserves safe-area space and scrolls only its multi-device list', async () => {
  const source = await readFile(sourceUrl, 'utf8')
  assert.ok(source.includes('--dsh-profile-top-clearance: max(40px, calc(env(safe-area-inset-top) + 12px))'))
  assert.ok(source.includes('overflow: hidden;'))
  assert.ok(source.includes('display: flex;'))
  assert.ok(source.includes('flex-direction: column;'))
  assert.ok(source.includes('width: 24px;'))
  assert.ok(source.includes('height: 24px;'))
  assert.ok(source.includes('border-radius: 26px;'))
  assert.ok(!source.includes('border-bottom: 0;'))
  assert.ok(source.includes('[data-profile-close]:hover'))
  assert.ok(source.includes('-webkit-tap-highlight-color: transparent;'))
  assert.ok(source.includes('box-shadow: none;'))
  assert.ok(!source.includes('box-shadow: 0 0 0 1px var(--dsw-alias-state-business-primary'))
  assert.ok(source.includes('panel.dataset.profileMultiple'))
  assert.ok(source.includes('deviceList.dataset.profileDeviceList'))
  assert.ok(source.includes('[data-profile-multiple] [data-profile-device-list]'))
  assert.ok(source.includes('overflow-y: auto;'))
})
