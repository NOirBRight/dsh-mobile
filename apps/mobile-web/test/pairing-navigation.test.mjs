import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('scanned offers force a shell reload instead of hash-only navigation', async () => {
  const source = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
  assert.match(source, /function reloadForOffer\(offerUrl: string\)/)
  assert.match(source, /history\.replaceState\(null, '', location\.pathname \+ location\.search \+ hash\)/)
  assert.match(source, /location\.reload\(\)/)
  assert.doesNotMatch(source, /location\.replace\(location\.pathname \+ location\.search \+ new URL\(offer\)\.hash\)/)
})
