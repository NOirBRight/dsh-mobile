import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'vite'

const fixtureRoot = resolve(import.meta.dirname, 'fixtures/mobile-agent-preset')

test('an empty Hero preset slot gets a visible mobile mode dropdown', async () => {
  const outDir = await mkdtemp(join(tmpdir(), 'dsh-mobile-agent-preset-'))
  try {
    await build({ root: fixtureRoot, base: './', configFile: false, logLevel: 'silent', build: { outDir, emptyOutDir: true } })
    const html = resolve(outDir, 'index.html')
    const source = await readFile(html, 'utf8')
    assert.match(source, /mobile-agent-preset-fixture/)
    const chrome = await import('node:child_process').then(({ spawnSync }) => spawnSync(
      process.env.CHROME_BIN ?? '/usr/bin/google-chrome',
      ['--headless=new', '--no-sandbox', '--disable-gpu', '--allow-file-access-from-files', '--virtual-time-budget=1500', '--dump-dom', 'file://' + html],
      { encoding: 'utf8', timeout: 15_000 },
    ))
    assert.equal(chrome.status, 0, chrome.stderr)
    assert.match(chrome.stdout, /data-ready="true"/)
    assert.match(chrome.stdout, /data-mobile-agent-preset-fallback/)
    assert.match(chrome.stdout, /role="menu"/)
    assert.match(chrome.stdout, /data-menu-open="true"/)
    assert.match(chrome.stdout, /Standard mode/)
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
})
