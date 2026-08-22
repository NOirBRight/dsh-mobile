import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('scanned and deep-link offers transition the resident HostSession without reloading', async () => {
  const source = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
  assert.ok(source.includes('function routeRuntimeOffer(offerUrl: string)'))
  assert.ok(source.includes('runtimeOfferHandler(offerUrl)'))
  assert.ok(source.includes('async function connectPairingOffer(offerUrl: string)'))
  assert.ok(source.includes('await session?.connect(next)'))
  assert.ok(!source.includes('location.reload()'))
})
