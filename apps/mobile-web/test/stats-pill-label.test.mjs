import test from 'node:test'
import assert from 'node:assert/strict'
import { compactStatsPillText } from '../../../packages/ui-layout-mobile/src/client/stats-line-presenter.ts'

test('readable labels keep speed units and cache meaning in both Host locales', () => {
  assert.equal(compactStatsPillText('1 turns 1 steps·135 tok/s'), '1T 1S · 135 tok/s')
  assert.equal(compactStatsPillText('12.8K tok·Cache hit 23%'), '12.8K · Cache 23%')
  assert.equal(compactStatsPillText('1 轮 1 步·135 tok/s'), '1 轮 1 步 · 135 tok/s')
  assert.equal(compactStatsPillText('12.8K tok·缓存命中 23%'), '12.8K · 缓存23%')
})

test('only constrained labels round long counts; absent readings stay absent', () => {
  assert.equal(compactStatsPillText('12,345 turns 67,890 steps · 999 tok/s', true), '12KT 68KS·999t/s')
  assert.equal(compactStatsPillText('999.9M tok · Cache hit 99.99%', true), '1B·C99.99%')
  assert.equal(compactStatsPillText('12.8K tok'), '12.8K')
  assert.equal(compactStatsPillText(''), '')
})
