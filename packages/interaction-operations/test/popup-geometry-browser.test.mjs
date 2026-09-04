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
    assert.equal(capture('genuine-outside-closed'), 'true', 'a genuine outside touch must reach upstream mousedown dismissal')
    assert.equal(capture('simple-narrow-width'), '144')
    assert.equal(capture('simple-at360-width'), '144')
    assert.equal(capture('simple-wide-width'), '144')
    assert.equal(capture('simple-at412-width'), '144')
    assert.equal(capture('simple-overflow-x'), 'hidden')
    assert.equal(capture('model-root-kind'), 'rich', 'the two-row official model root must retain picker geometry')
    assert.equal(capture('model-root-width'), '240', 'the official model root must not collapse to the generic 144px menu width')
    assert.equal(capture('model-label-single-line'), 'true', 'the Model row label must stay on one line')
    assert.equal(capture('choice-kind'), 'rich')
    assert.equal(capture('choice-narrow-width'), '296', 'choice menus must keep 12px narrow viewport gutters')
    assert.equal(capture('choice-at360-width'), '320')
    assert.equal(capture('choice-wide-width'), '320', 'choice menus must recover their authored width after widening')
    assert.equal(capture('choice-at412-width'), '320')
    assert.equal(capture('choice-overflow-y'), 'auto', 'tall rich choices must remain vertically scrollable')
    assert.equal(capture('choice-overflow-x'), 'hidden', 'bilingual choice text must not create a horizontal scrollbar')
    assert.equal(capture('choice-scroll-top'), '80', 'scroll-driven geometry refresh must not reset the workspace menu position')
    assert.equal(capture('nested-outer-overflow-y'), 'hidden', 'composite picker chrome must delegate vertical scrolling')
    assert.equal(capture('nested-inner-overflow-y'), 'auto', 'nested model rows must retain vertical scroll ownership')
    assert.equal(capture('workspace-portal-marker'), 'rich', 'the official workspace portal must keep bounded mobile geometry')
    assert.equal(capture('workspace-portal-max-height'), '360px')
    assert.equal(capture('composer-overlay-position'), 'absolute', 'slash/@ overlays must keep the Host card-relative anchor')
    assert.equal(capture('composer-overlay-marker'), '', 'card overlays without an ARIA trigger must not enter fixed popup presentation')
    assert.notEqual(capture('composer-overlay-z-index'), '1200', 'composer overlays must not float over the conversation header')
    assert.equal(capture('choice-width'), '320', 'choice menus must preserve their authored picker width')
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
})
