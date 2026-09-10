import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { build } from 'vite'

/** Upstream checkout selected by prepare-upstream.mjs; an explicit env still wins. */
const upstream = process.env.DSH_UPSTREAM ?? resolve(import.meta.dirname, '../../../.dsh-upstream')
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
          '@deepseek-ai/dsh-client-ui-primitives': resolve(upstream, 'packages/client/ui-primitives/src/index.ts'),
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
    assert.equal(capture('mode-open-after-plus'), 'false', 'opening the plus menu must close the existing mode menu')
    assert.equal(capture('send-focus'), 'other', 'Send must not refocus the editor on mobile')
    assert.equal(capture('main-entered'), 'true', 'a busy main Send must route through the official keyboard policy')
    assert.equal(capture('main-enter-text'), 'main follow-up', 'the main draft payload must ride the delegated gesture')
    assert.equal(capture('main-submit'), 'false', 'a busy ordinary session must not take the queue-only fallback')
    assert.equal(capture('main-send-hidden'), '', 'a lone main Send is never hidden')
    assert.equal(capture('child-send-hidden'), 'true', 'a running child hides its unusable Send: one primary')
    assert.equal(capture('child-send-inline'), '', 'hiding never mutates the original inline style')
    assert.equal(capture('child-stop-hidden'), '', 'the child interrupt Stop stays usable while Send is hidden')
    assert.equal(capture('child-stop-inline'), '', 'the visible Stop keeps its original inline style')
    assert.equal(capture('child-stop-label'), 'Stop', 'the child interrupt Stop must keep its accessible label')
    assert.equal(capture('child-draft-interrupt'), 'true', 'tapping interrupt with a draft must reach the Host control')
    assert.equal(capture('child-draft-enter'), 'false', 'tapping interrupt must not enter the send path')
    assert.equal(capture('child-draft-stop-label'), 'Stop', 'a follow-up draft must keep the interrupt label')
    assert.equal(capture('child-send-hidden-after-enable'), '', 'an enabled Send returns: one primary')
    assert.equal(capture('child-send-inline-after-enable'), '', 'returning keeps the original inline style')
    assert.equal(capture('child-stop-hidden-after-enable'), 'true', 'a usable Send hides the interrupt Stop: one primary')
    assert.equal(capture('child-stop-inline-after-enable'), '', 'hiding the Stop never mutates its inline style')
    assert.equal(capture('child-entered'), 'true', 'the child Send must delegate through its own editor')
    assert.equal(capture('child-enter-text'), 'child follow-up', 'the child draft must not leak into the main composer')
    assert.equal(capture('main-enter-count-after-child'), '1:1', 'a child Send must not submit the main composer')
    assert.equal(capture('child-send-hidden-back'), 'true', 'flipping Send back to disabled re-hides it')
    assert.equal(capture('child-send-inline-back'), '', 're-hiding keeps the original inline style')
    assert.equal(capture('child-stop-hidden-back'), '', 'flipping Send back to disabled restores the Stop')
    assert.equal(capture('child-stop-inline-back'), '', 'the restored Stop keeps its original inline style')
    assert.equal(capture('child-send-hidden-after-unmount'), '', 'unmount must clear the Send marker')
    assert.equal(capture('child-send-inline-after-unmount'), '', 'unmount must leave the original inline style')
    assert.equal(capture('child-stop-hidden-after-unmount'), '', 'unmount must clear the Stop marker')
    assert.equal(capture('child-stop-inline-after-unmount'), '', 'unmount must leave the Stop inline style alone')
    assert.equal(capture('model-menu-after-ctx'), 'false', 'tapping the context meter must close an open picker')
    const bottomDelta = Number(capture('ctx-panel-bottom-delta'))
    assert.ok(bottomDelta <= -7 && bottomDelta >= -9, 'the context panel keeps the official 8px-above-trigger anchor: ' + bottomDelta)
    assert.notEqual(capture('ctx-panel-transform'), 'none', 'an overflowing context panel must be clamped back on-screen')
    assert.ok(Number(capture('ctx-panel-right')) <= 348, 'the context panel must not overflow the right edge with the 12px inset: ' + capture('ctx-panel-right'))
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
})
