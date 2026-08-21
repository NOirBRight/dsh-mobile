import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { build } from 'vite'

const fixtureRoot = resolve(import.meta.dirname, 'fixtures/mobile-session-focus')

test('switching sessions does not leave the composer textarea focused', async () => {
  const outDir = await mkdtemp(join(tmpdir(), 'dsh-mobile-session-focus-'))
  try {
    await build({ root: fixtureRoot, base: './', configFile: false, logLevel: 'silent', build: { outDir, emptyOutDir: true } })
    const page = resolve(outDir, 'index.html')
    const chrome = spawnSync(process.env.CHROME_BIN ?? '/usr/bin/google-chrome', [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--allow-file-access-from-files',
      '--window-size=360,800', '--virtual-time-budget=2000', '--dump-dom', 'file://' + page,
    ], { encoding: 'utf8', timeout: 15_000 })
    assert.equal(chrome.status, 0, chrome.stderr)
    assert.match(chrome.stdout, /data-ready="true"/, 'session focus fixture did not settle')
    const active = new RegExp('data-active-after-switch="([^"]*)"').exec(chrome.stdout)?.[1]
    assert.notEqual(active, 'message', 'session switch must blur the retained composer textarea')
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
})
