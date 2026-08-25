import test from 'node:test'
import assert from 'node:assert/strict'
import { compactStatsCopy } from '../../../packages/ui-layout-mobile/src/client/compact-stats.ts'

test('compact stats main line matches the narrow copy', () => {
  const copy = compactStatsCopy(
    {
      turns: 12, steps: 1204, llmMs: 15_000, toolMs: 0,
      ttftMs: 2_400, ttftSteps: 2, decodeMs: 2_000, decodeTokens: 124,
    },
    { uncachedInputTokens: 48_000, cacheReadTokens: 12_000, cacheWriteTokens: 0, outputTokens: 8_000 },
    { projectedTokens: 97_000, contextWindow: 100_000 },
  )
  assert.equal(copy?.main, 'TTFT 1.2s · 62 tok/s · 缓存命中率 20% · ↑60K ↓8K')
  assert.equal('detail' in (copy ?? {}), false, 'mobile stats must not expose an expanded detail row')
})

test('compact stats hides empty groups', () => {
  assert.equal(compactStatsCopy(undefined, undefined, undefined), null)
  const copy = compactStatsCopy(
    { turns: 0, steps: 0, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0 },
    { uncachedInputTokens: 12, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 3 },
    undefined,
  )
  assert.equal(copy?.main, '缓存命中率 0% · ↑12 ↓3')

  const english = compactStatsCopy(
    { turns: 1, steps: 1, llmMs: 0, toolMs: 0, ttftMs: 9_900, ttftSteps: 1, decodeMs: 1_000, decodeTokens: 68 },
    { uncachedInputTokens: 80, cacheReadTokens: 20, cacheWriteTokens: 0, outputTokens: 9 },
    undefined,
    'en',
  )
  assert.equal(english?.main, 'TTFT 9.9s · 68 tok/s · Cache hit 20% · ↑100 ↓9')
})
