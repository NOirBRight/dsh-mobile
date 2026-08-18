import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'vite'

const fixtureRoot = resolve(import.meta.dirname, 'fixtures/mobile-layout')

test('mobile drawer closes on navigation and reports its constrained rendered width', async () => {
  const outDir = await mkdtemp(join(tmpdir(), 'dsh-mobile-ui-'))
  try {
    await build({ root: fixtureRoot, base: './', configFile: false, logLevel: 'silent', build: { outDir, emptyOutDir: true } })
    const page = resolve(outDir, 'index.html')
    const chrome = spawnSync(process.env.CHROME_BIN ?? '/usr/bin/google-chrome', [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--allow-file-access-from-files',
      '--window-size=360,800', '--virtual-time-budget=2000', '--dump-dom', 'file://' + page,
    ], { encoding: 'utf8', timeout: 15_000 })
    assert.equal(chrome.status, 0, chrome.stderr)
    assert.match(chrome.stdout, /data-ready="true"/, 'browser fixture did not settle')
    const capture = (name) => new RegExp('data-' + name + '="([^"]*)"').exec(chrome.stdout)?.[1]
    assert.equal(capture('close-count'), '1')
    assert.equal(capture('official-drawer-width'), '280')
    assert.equal(capture('official-owner-width'), '280')
    assert.equal(capture('drawer-width'), '240')
    assert.equal(capture('owner-width'), '240')
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
})
