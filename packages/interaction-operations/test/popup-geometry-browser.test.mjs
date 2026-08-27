import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { build } from 'vite'

const fixtureRoot = resolve(import.meta.dirname, 'browser')

test('popup anchors and authored choice width survive mobile compatibility geometry', async () => {
  const outDir = await mkdtemp(resolve(tmpdir(), 'dsh-popup-geometry-'))
  try {
    await build({ root: fixtureRoot, base: './', configFile: false, logLevel: 'silent', build: { outDir, emptyOutDir: true } })
    const chrome = spawnSync(process.env.CHROME_BIN ?? '/usr/bin/google-chrome', [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--run-all-compositor-stages-before-draw',
      '--allow-file-access-from-files', '--window-size=320,800', '--virtual-time-budget=2000',
      '--dump-dom', 'file://' + resolve(outDir, 'index.html'),
    ], { encoding: 'utf8', timeout: 15_000 })
    assert.equal(chrome.status, 0, chrome.stderr)
    assert.match(chrome.stdout, /data-ready="true"/, chrome.stderr)
    const capture = name => new RegExp('data-' + name + '="([^"]*)"').exec(chrome.stdout)?.[1]
    assert.equal(capture('anchor-closed'), 'true', 'an open popup anchor must close once without pre-click dismissal')
    assert.equal(capture('replacement-anchor-preserved'), 'true', 'a replacement ARIA owner must not be treated as outside')
    assert.equal(capture('replacement-anchor-align'), 'start', 'placement must retain the currently touched owner over stale DOM order')
    assert.equal(capture('replacement-anchor-closed'), 'true', 'the replacement owner click must close and stay closed')
    assert.equal(capture('choice-kind'), 'rich')
    assert.equal(capture('choice-narrow-width'), '296', 'choice menus must keep 12px narrow viewport gutters')
    assert.equal(capture('choice-at360-width'), '320')
    assert.equal(capture('choice-wide-width'), '320', 'choice menus must recover their authored width after widening')
    assert.equal(capture('choice-at412-width'), '320')
    assert.equal(capture('choice-overflow-y'), 'auto', 'tall rich choices must remain vertically scrollable')
    assert.equal(capture('choice-overflow-x'), 'hidden', 'bilingual choice text must not create a horizontal scrollbar')
    assert.equal(capture('nested-outer-overflow-y'), 'hidden', 'composite picker chrome must delegate vertical scrolling')
    assert.equal(capture('nested-inner-overflow-y'), 'auto', 'nested model rows must retain vertical scroll ownership')
    assert.equal(capture('choice-width'), '320', 'choice menus must preserve their authored picker width')
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
})
