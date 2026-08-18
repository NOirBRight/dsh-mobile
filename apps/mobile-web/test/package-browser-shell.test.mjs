import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

test('mobile-web build installs the browser shell when DSH_HOME is set', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.match(pkg.scripts.build, /package-browser-shell/)
})

test('browser-shell installer skips when no destination is configured', () => {
  const env = { ...process.env }
  delete env.DSH_HOME
  delete env.DSH_MOBILE_BROWSER_SHELL
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/package-browser-shell.mjs', import.meta.url))], { encoding: 'utf8', env })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /skip browser-shell install/)
})
