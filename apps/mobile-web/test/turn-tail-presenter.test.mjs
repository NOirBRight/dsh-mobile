import test from 'node:test'
import assert from 'node:assert/strict'
import { compactTurnTailText } from '../../../packages/ui-layout-mobile/src/client/turn-tail-presenter.ts'

test('mobile turn tail keeps only clock duration and throughput', () => {
  assert.equal(compactTurnTailText('23:41 · Ran for 15s · TTFT 1.2s · 72 tok/s'), '23:41 · 15s · 72 tok/s')
  assert.equal(compactTurnTailText('23:41 · 运行 15 秒 · TTFT 1.2秒 · 72 tok/s'), '23:41 · 15s · 72 tok/s')
})

test('turn tail omits absent groups without inventing values', () => {
  assert.equal(compactTurnTailText('23:41 · Ran for 15s'), '23:41 · 15s')
  assert.equal(compactTurnTailText('23:41'), '23:41')
})
