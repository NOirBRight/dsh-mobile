import test from 'node:test'
import assert from 'node:assert/strict'
import { compactModelOptionDetail, compactModelTriggerLabel } from '../../../packages/ui-layout-mobile/src/client/model-picker-presenter.ts'

test('mobile model details remove the redundant provider label before capacity', () => {
  assert.equal(compactModelOptionDetail('Standard · 272K'), '272K')
  assert.equal(compactModelOptionDetail('标准 · 272K'), '272K')
  assert.equal(compactModelOptionDetail('DeepSeek · 1M'), '1M')
})

test('non-capacity option descriptions remain unchanged', () => {
  assert.equal(compactModelOptionDetail('DeepSeek · Fast model'), 'DeepSeek · Fast model')
  assert.equal(compactModelOptionDetail('272K'), '272K')
})

test('composer model trigger keeps the product name and drops only · menu suffixes', () => {
  const catalog = [
    'Grok 4.6', 'Grok 4.5', 'Gemini 3.8 Flash', 'Gemini 3.7 Flash',
    'Claude Sonnet 4.6', 'Claude Fable 5', 'Claude Opus 5', 'Opus 4.6', 'Sonnet 4.6',
    'GPT-6', 'DeepSeek V4 Flash', 'DeepSeek V4 Flash (latest)',
    'DeepSeek V4 Flash Vision (exp)', 'DeepSeek V4 Pro (latest)',
    'Cursor Grok 4.6', 'Composer 2.5', 'GLM-5.3 Flash', 'GPT-5.6 Sol Fast',
    'Kimi K3', 'Muse Spark 1.3 Contributor',
  ]
  for (const name of catalog) {
    assert.equal(compactModelTriggerLabel(name), name)
    assert.equal(compactModelTriggerLabel(name + ' · High Effort'), name)
  }
  assert.equal(compactModelTriggerLabel('Grok 4.6 · High · Fast · 1M · Thinking'), 'Grok 4.6')
  assert.equal(compactModelTriggerLabel('Gemini 3.8 Flash · High Effort'), 'Gemini 3.8 Flash')
})
