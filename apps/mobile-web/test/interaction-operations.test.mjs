import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { build } from 'vite'

const fixtureRoot = resolve(import.meta.dirname, 'fixtures/interaction-operations')

test('touch adapters expose actions, route gestures, and retract cleanly', async () => {
  const outDir = await mkdtemp(join(tmpdir(), 'dsh-interaction-operations-'))
  try {
    await build({ root: fixtureRoot, base: './', configFile: false, logLevel: 'silent', build: { outDir, emptyOutDir: true } })
    const chrome = spawnSync(process.env.CHROME_BIN ?? '/usr/bin/google-chrome', [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--run-all-compositor-stages-before-draw', '--allow-file-access-from-files',
      '--window-size=360,800', '--virtual-time-budget=2000', '--dump-dom', 'file://' + resolve(outDir, 'index.html'),
    ], { encoding: 'utf8', timeout: 15_000 })
    assert.equal(chrome.status, 0, chrome.stderr)
    assert.match(chrome.stdout, /data-ready="true"/, chrome.stderr)
    const capture = name => new RegExp('data-' + name + '="([^"]*)"').exec(chrome.stdout)?.[1]
    assert.equal(capture('enter-hint'), 'enter')
    assert.equal(capture('row-marked'), 'true')
    assert.equal(capture('actions-marked'), 'true')
    assert.equal(capture('lazy-row-marked'), 'true')
    assert.equal(capture('inspect-marked'), 'true')
    assert.equal(capture('operations'), 'open-navigation,open-popup,open-context-actions')
    assert.equal(capture('drawer-opened'), 'true')
    assert.equal(capture('popup-first-opened'), 'true', 'the first touch must retain its popup fallback')
    assert.equal(capture('popup-opened'), 'false')
    assert.equal(capture('popup-retracted'), 'true', 'a second tap on an expanded subagent trigger must close it')
    assert.equal(capture('context-opened'), 'true')
    assert.equal(capture('profile-back-closed'), 'true', 'Back must close the profile modal instead of consuming a no-op Escape')
    assert.equal(capture('mixed-back-first'), 'details', 'DOM details must precede a registered drawer')
    assert.equal(capture('model-touch-outside-closed'), 'true', 'touching outside must reach the official model mousedown dismissal')
    assert.equal(capture('model-mode-click-closed'), 'true', 'clicking Mode must dismiss an open searchable model picker')
    assert.equal(capture('model-question-closed'), 'true', 'a question takeover must dismiss an already-open model picker')
    assert.equal(capture('model-select-question-closed'), 'true', 'a question takeover must dismiss pointer-owned searchable model pickers')
    assert.equal(capture('model-back-closed'), 'true', 'Back Escape must target the model picker root')
    assert.equal(capture('question-back-minimized'), 'true', 'Back must minimize a question takeover')
    assert.equal(capture('popup-simple-width'), '144', 'simple mobile menus should shrink to their content class')
    assert.equal(capture('popup-left-aligned'), 'true')
    assert.equal(capture('popup-right-aligned'), 'true', 'right delta: ' + capture('popup-right-delta'))
    assert.equal(capture('popup-rich-max-height'), '360px', 'model picker must retain its compact mobile height')
    assert.equal(capture('popup-rich-overflow'), 'hidden', 'model picker chrome must not become the scroll owner')
    assert.equal(capture('popup-rich-scrolls'), 'true', 'model rows must scroll inside the compact picker')
    assert.equal(capture('popup-select-card-presented'), 'rich', 'geometry must size the searchable card, not detach its listbox')
    assert.equal(capture('popup-select-listbox-presented'), '', 'internal model rows must remain owned by their card')
    assert.equal(capture('cleanup'), 'false,false,false')
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
})
