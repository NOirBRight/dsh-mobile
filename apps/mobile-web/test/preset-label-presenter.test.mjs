import test from 'node:test'
import assert from 'node:assert/strict'
import { compactPresetLabel } from '../../../packages/ui-layout-mobile/src/client/preset-label-presenter.ts'

test('PTC preset labels collapse to one language-neutral mobile token', () => {
  assert.equal(compactPresetLabel('PTC'), 'PTC')
  assert.equal(compactPresetLabel('PTC mode'), 'PTC')
  assert.equal(compactPresetLabel('PTC 模式'), 'PTC')
})

test('custom preset names remain untouched', () => {
  assert.equal(compactPresetLabel('My PTC mode'), null)
  assert.equal(compactPresetLabel('Standard mode'), null)
  assert.equal(compactPresetLabel('PTC custom'), null)
})
