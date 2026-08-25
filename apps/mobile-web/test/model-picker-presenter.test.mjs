import test from 'node:test'
import assert from 'node:assert/strict'
import { compactModelOptionDetail } from '../../../packages/ui-layout-mobile/src/client/model-picker-presenter.ts'

test('mobile model details remove the redundant provider label before capacity', () => {
  assert.equal(compactModelOptionDetail('Standard · 272K'), '272K')
  assert.equal(compactModelOptionDetail('标准 · 272K'), '272K')
  assert.equal(compactModelOptionDetail('DeepSeek · 1M'), '1M')
})

test('non-capacity option descriptions remain unchanged', () => {
  assert.equal(compactModelOptionDetail('DeepSeek · Fast model'), 'DeepSeek · Fast model')
  assert.equal(compactModelOptionDetail('272K'), '272K')
})
