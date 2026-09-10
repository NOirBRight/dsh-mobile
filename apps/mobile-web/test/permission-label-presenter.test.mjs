import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isPermissionTriggerLabel,
  permissionTriggerNeedsGenericIcon,
} from '../../../packages/ui-layout-mobile/src/client/permission-label-presenter.ts'

test('permission triggers match official access-mode aria in both languages', () => {
  assert.equal(isPermissionTriggerLabel('Access mode, current: Workspace Write'), true)
  assert.equal(isPermissionTriggerLabel('访问模式，当前：只读'), true)
  assert.equal(isPermissionTriggerLabel('Select model, current Grok 4.6'), false)
})

test('generic icon is only for permission triggers without a leading glyph', () => {
  const withGlyph = { querySelector: (sel) => sel.includes('svg') ? {} : null }
  const without = { querySelector: () => null }
  assert.equal(permissionTriggerNeedsGenericIcon(withGlyph), false)
  assert.equal(permissionTriggerNeedsGenericIcon(without), true)
})

test('permission presenter does not require aria-haspopup the Host never sets', async () => {
  const { readFile } = await import('node:fs/promises')
  const { resolve } = await import('node:path')
  const source = await readFile(resolve(import.meta.dirname, '../../../packages/ui-layout-mobile/src/client/permission-label-presenter.ts'), 'utf8')
  assert.doesNotMatch(source, /button\[aria-haspopup=\\"menu\\"\]/, 'Access mode button has no aria-haspopup')
  assert.match(source, /button\[aria-label\]/)
  assert.match(source, /isPermissionTriggerLabel/)
})
