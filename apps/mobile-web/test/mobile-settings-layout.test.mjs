import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { build } from 'vite'

const fixtureRoot = resolve(import.meta.dirname, 'fixtures/mobile-settings-layout')

test('mobile settings uses a full-width panel and horizontal category navigation', async () => {
  const outDir = await mkdtemp(join(tmpdir(), 'dsh-mobile-settings-'))
  try {
    await build({ root: fixtureRoot, base: './', configFile: false, logLevel: 'silent', build: { outDir, emptyOutDir: true } })
    const chrome = spawnSync(process.env.CHROME_BIN ?? '/usr/bin/google-chrome', [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--allow-file-access-from-files',
      '--window-size=360,800', '--virtual-time-budget=2000', '--dump-dom', 'file://' + resolve(outDir, 'index.html'),
    ], { encoding: 'utf8', timeout: 15_000 })
    assert.equal(chrome.status, 0, chrome.stderr)
    assert.match(chrome.stdout, /data-ready="true"/, 'settings fixture did not settle')
    const capture = (name) => new RegExp('data-' + name + '=\"([^\"]*)\"').exec(chrome.stdout)?.[1]
    const viewportWidth = Number(capture('viewport-width'))
    const viewportHeight = Number(capture('viewport-height'))
    assert.equal(capture('panel-width'), String(viewportWidth - 24), 'mobile settings panel should preserve usable side margins')
    assert.equal(capture('panel-height'), String(viewportHeight - 24), 'mobile settings panel should use the visible viewport')
    assert.equal(capture('nav-width'), capture('panel-width'), 'settings navigation should span the panel')
    assert.equal(capture('nav-list-direction'), 'row', 'settings categories should become a horizontal row')
    assert.equal(capture('nav-list-overflow'), 'auto', 'settings categories should be horizontally scrollable')
    assert.equal(capture('codex-toggle-visibility'), 'hidden', 'Codex sidebar toggle should not paint above settings')
    assert.equal(capture('codex-toggle-pointer-events'), 'none', 'Codex sidebar toggle should not intercept settings taps')
    assert.equal(capture('codex-handle-visibility'), 'hidden', 'Codex resize handle should not paint above settings')
    assert.equal(capture('content-width'), capture('panel-width'), 'settings content should regain the full panel width')
    assert.equal(capture('section-width'), capture('options-content-width'), 'provider content should not retain desktop width')
    assert.equal(capture('section-scroll-width'), capture('section-width'), 'provider card should fit inside the mobile section')
    assert.equal(capture('theme-direction'), 'row', 'theme choices should share one horizontal row')
    assert.equal(capture('theme-wrap'), 'nowrap', 'theme choices should not become vertical cards')
    assert.equal(capture('theme-button-count'), '3')
    assert.ok(Number(capture('theme-button-width')) < Number(capture('panel-width')), 'theme buttons should share the panel')
    assert.equal(capture('theme-button-height'), '64', 'theme choices should be compact horizontal rectangles')
    assert.equal(capture('theme-button-direction'), 'row', 'theme icon and label should share one line')
    assert.equal(capture('theme-button-white-space'), 'nowrap', 'theme labels should stay readable without character stacking')
    assert.equal(capture('theme-icon-width'), '20')
    assert.equal(capture('theme-icon-height'), '20')
    assert.equal(capture('theme-font-size'), '13px', 'theme labels should fit without crowding their icons')
    assert.ok(Number(capture('theme-label-right-gap')) >= 6, 'theme labels should keep a right inset')
    assert.equal(capture('enter-title-white-space'), 'nowrap', 'Enter label should not orphan its final character')
    assert.equal(capture('close-position'), 'absolute', 'settings close action should stay at the panel corner')
    assert.ok(Number(capture('close-top')) <= 20, 'settings close action should sit near the panel top')
    assert.equal(capture('content-min-width'), '0px')
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
})
