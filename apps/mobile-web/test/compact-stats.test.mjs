import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

test('mobile layout does not register a compact stats occupant', async () => {
  const source = await readFile(
    resolve(import.meta.dirname, '../../../packages/ui-layout-mobile/src/client/index.ts'),
    'utf8',
  )
  assert.doesNotMatch(source, /CompactStatsLine/)
  assert.doesNotMatch(source, /id: 'stats'/)
})
