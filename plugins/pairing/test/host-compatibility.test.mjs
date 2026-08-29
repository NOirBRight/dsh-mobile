import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8')

test('declares an Alpha1-inclusive 0.x host peer range from the renamed rc.1 floor', () => {
  const range = '>=0.1.0-rc.6 <0.1.1 || >=0.1.1-rc.1 <1.0.0 || >=0.1.2-alpha.1 <1.0.0'
  for (const service of ['@deepseek-ai/dsh-host-webserver', '@deepseek-ai/dsh-settings']) {
    assert.equal(packageJson.peerDependencies[service], range)
    assert.equal(packageJson.devDependencies[service], '0.1.1-rc.1')
  }

  assert.equal(JSON.stringify(packageJson).includes('0.0.1'), false)
})

test('uses official Cordis service augmentation instead of masking Context mismatches', () => {
  assert.match(source, /const webServer: WebServer = ctx\.webServer/)
  assert.match(source, /ctx\.settings\.register\(settingsNamespace\('dsh-mobile'\)/)
  assert.doesNotMatch(source, /ctx as unknown as \{ (?:webServer|settings)/)
})
