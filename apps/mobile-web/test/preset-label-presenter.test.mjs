import test from 'node:test'
import assert from 'node:assert/strict'
import { compactPresetLabel, identifyBuiltInPreset } from '../../../packages/ui-layout-mobile/src/client/preset-label-presenter.ts'

test('official preset ids and full names collapse to locale-owned compact words', () => {
  assert.equal(identifyBuiltInPreset('standard'), 'standard')
  assert.equal(identifyBuiltInPreset('Standard mode'), 'standard')
  assert.equal(identifyBuiltInPreset('标准模式'), 'standard')
  assert.equal(identifyBuiltInPreset('PTC 模式'), 'ptc')
  assert.equal(identifyBuiltInPreset('Minimal mode'), 'minimal')
  assert.equal(identifyBuiltInPreset('创造模式'), 'cordis')
  assert.equal(compactPresetLabel('standard', 'zh-CN'), '标准')
  assert.equal(compactPresetLabel('Standard mode', 'zh'), '标准')
  assert.equal(compactPresetLabel('标准模式', 'en'), 'Standard')
  assert.equal(compactPresetLabel('PTC mode', 'zh-CN'), 'PTC')
  assert.equal(compactPresetLabel('PTC 模式', 'en-US'), 'PTC')
  assert.equal(compactPresetLabel('minimal', 'zh'), '极简')
  assert.equal(compactPresetLabel('极简模式', 'en'), 'Minimal')
  assert.equal(compactPresetLabel('cordis', 'zh-CN'), '创造')
  assert.equal(compactPresetLabel('Creator mode', 'en'), 'Creator')
})

test('custom preset names and unknown ids remain untouched', () => {
  assert.equal(compactPresetLabel('My PTC mode'), null)
  assert.equal(compactPresetLabel('code'), null)
  assert.equal(compactPresetLabel('PTC custom'), null)
  assert.equal(identifyBuiltInPreset('code'), null)
})
