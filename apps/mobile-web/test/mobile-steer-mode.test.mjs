import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { build } from 'vite'

/** Upstream checkout selected by prepare-upstream.mjs; an explicit env still wins. */
const upstream = process.env.DSH_UPSTREAM ?? resolve(import.meta.dirname, '../../../.dsh-upstream')
const fixtureRoot = resolve(import.meta.dirname, 'fixtures/mobile-steer-mode')

test('busy Send delegates to the Core keyboard policy through hook state', async () => {
  const outDir = await mkdtemp(join(tmpdir(), 'dsh-mobile-steer-'))
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
    assert.match(chrome.stdout, /data-ready="true"/, 'steer fixture did not settle: ' + chrome.stderr)
    const capture = (name) => new RegExp('data-' + name + '="([^"]*)"').exec(chrome.stdout)?.[1]
    assert.equal(capture('mode-steer'), 'steer', 'a busy Send must reach the Core policy with the Steer preference')
    assert.equal(capture('text-steer'), 'main follow-up', 'the draft payload must ride the delegated gesture')
    assert.equal(capture('submit-steer'), 'false', 'a busy session must not take the queue-only fallback')
    assert.equal(capture('main-hidden-steer'), '', 'a lone main Send is never hidden')
    assert.equal(capture('mode-queue'), 'queue', 'the Queue preference must reach the Core policy on the same seat')
    assert.equal(capture('submit-idle'), 'true', 'an idle seat takes the queue-only fallback when Core leaves the gesture open')
    assert.equal(capture('mode-idle'), 'unset', 'the idle fallback submits without a steered mode')
    assert.equal(capture('child-send-hidden'), 'true', 'the running child hides its unusable Send')
    assert.equal(capture('child-entered'), 'true', 'the child Send must delegate through its own editor')
    assert.equal(capture('child-enter-text'), 'child follow-up', 'a child Send must not submit the main composer')
    assert.equal(capture('main-count-after-child'), '3:3', 'the main count must not move for a child Send')
    assert.equal(capture('child-hidden-after-unmount'), '', 'unmount must clear the hiding marker')
    assert.equal(capture('child-inline-after-unmount'), '', 'unmount must leave the original inline style')
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
})
