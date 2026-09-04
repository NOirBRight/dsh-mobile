import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

test('mobile shell parks the assistant pet above the composer action lane', async () => {
  const source = await readFile(resolve(import.meta.dirname, '../src/main.ts'), 'utf8')
  assert.match(
    source,
    /body\s+\.dsh-assistant-pet\s*\{[^}]*bottom:\s*(?:9[6-9]|[1-9]\d{2,})px\s*!important/s,
    'the assistant pet must leave the mobile composer send target unobstructed',
  )
  assert.match(
    source,
    /function installMobileActionStyles\(\): void \{[\s\S]*?\n\}\n\ninstallMobileActionStyles\(\)/,
    'mobile action styles must be installed for already-paired cold boots',
  )
  assert.match(
    source,
    /await webEntry\.run\(\)\n\s+installMobileActionStyles\(\)/,
    'mobile action styles must be restored after the Host shell remounts its document head',
  )
})
