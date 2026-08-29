import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { build } from 'vite'

const fixtureRoot = resolve(import.meta.dirname, 'fixtures/mobile-interactions')

test('mobile composer closes other menus and never focuses input from send or stop', async () => {
  const outDir = await mkdtemp(join(tmpdir(), 'dsh-mobile-interactions-'))
  try {
    await build({
      root: fixtureRoot,
      base: './',
      configFile: false,
      logLevel: 'silent',
      resolve: {
        dedupe: ['react', 'react-dom'],
        alias: {
          '@deepseek-ai/dsh-client-ui-primitives': resolve('/home/noirbright/Workstation/dsh-wt-02/packages/client/ui-primitives/src/index.ts'),
        },
      },
      build: { outDir, emptyOutDir: true },
    })
    const chrome = spawnSync(process.env.CHROME_BIN ?? '/usr/bin/google-chrome', [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--allow-file-access-from-files',
      '--window-size=360,800', '--virtual-time-budget=2000', '--dump-dom', 'file://' + resolve(outDir, 'index.html'),
    ], { encoding: 'utf8', timeout: 15_000 })
    assert.equal(chrome.status, 0, chrome.stderr)
    assert.match(chrome.stdout, /data-ready="true"/, 'interaction fixture did not settle: ' + chrome.stderr)
    const capture = (name) => new RegExp('data-' + name + '="([^"]*)"').exec(chrome.stdout)?.[1]
    assert.equal(capture('mode-open-after-plus'), 'false', 'opening the image menu must close the existing mode menu')
    assert.equal(capture('send-focus'), 'other', 'Send must not refocus the textarea on mobile')
    assert.equal(capture('click-reached-stop'), 'true', 'the ordinary primary Stop remains clickable before the draft bridge')
    assert.equal(capture('stop-focus'), 'other', 'Stop must not refocus the textarea on mobile')
    assert.equal(capture('direct-enter'), 'true:false', 'the handled official Enter seam must cancel the synthetic DOM event')
    assert.equal(capture('stop-marked-before-mousedown'), 'true', 'the marker must already exist before the first tap')
    assert.equal(capture('draft-stop-mouse-down-prevented'), 'false', 'a drafted follow-up must keep the first tap alive')
    assert.equal(capture('draft-stop-marked'), 'true', 'the busy primary action must expose Send styling for a draft')
    assert.equal(capture('draft-stop-glyph'), 'true', 'the busy primary action must paint the Send glyph for a draft')
    assert.equal(capture('draft-stop-svg-display'), 'none', 'the busy primary action must hide the Stop glyph')
    assert.equal(capture('draft-stop-font-size'), '0px', 'the busy primary action must hide any Stop text')
    assert.equal(capture('draft-stop-label'), '发送消息', 'the busy primary action must expose the accessible Send label')
    assert.equal(capture('draft-cleared'), 'true', 'clearing the draft must restore the official primary action')
    assert.equal(capture('draft-restored-label'), '停止生成', 'clearing the draft must restore the Stop label')
    assert.equal(capture('interrupt-stop-clicked'), 'true', 'the preceding interruptible Stop must remain independent')
    assert.equal(capture('stop-clicked'), undefined, 'a drafted follow-up must not invoke the primary Stop')
    assert.equal(capture('draft-submit'), 'false', 'a drafted follow-up must not bypass the Host busy-send policy')
    assert.equal(capture('draft-enter'), 'true', 'a drafted follow-up must route through the official keyboard policy')
    assert.equal(capture('image-stop-marked'), 'true', 'an image-only draft must also switch the busy primary seat to Send')
    assert.equal(capture('image-stop-label'), '发送消息', 'an image-only draft must expose the Send label')
    assert.equal(capture('image-stop-glyph'), 'true', 'an image-only draft must paint the Send glyph')
    assert.equal(capture('image-send-disabled-restored'), 'true', 'the Host-owned disabled state must be restored after an image-only tap')
    assert.equal(capture('image-send-entered'), 'true', 'an image-only draft must send on the first tap')
    assert.equal(capture('model-menu-after-ctx'), 'false', 'tapping the context meter must close an open picker')
    const bottomDelta = Number(capture('ctx-panel-bottom-delta'))
    assert.ok(bottomDelta <= -7 && bottomDelta >= -9, 'the context panel keeps the official 8px-above-trigger anchor: ' + bottomDelta)
    assert.notEqual(capture('ctx-panel-transform'), 'none', 'an overflowing context panel must be clamped back on-screen')
    assert.ok(Number(capture('ctx-panel-right')) <= 348, 'the context panel must not overflow the right edge with the 12px inset: ' + capture('ctx-panel-right'))
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
})
