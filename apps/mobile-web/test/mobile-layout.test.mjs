import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'vite'

const fixtureRoot = resolve(import.meta.dirname, 'fixtures/mobile-layout')

test('mobile layout does not paginate older history during session changes', async () => {
  const source = await readFile(resolve(import.meta.dirname, '../../../packages/ui-layout-mobile/src/client/index.ts'), 'utf8')
  assert.doesNotMatch(source, /history-prefetch|loadOlder/, 'session changes must not start background history pagination')
})

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
    assert.equal(capture('close-count'), '2', 'session rows and New session should close the drawer')
    assert.equal(capture('official-drawer-width'), '280')
    assert.equal(capture('official-owner-width'), '280')
    assert.equal(capture('drawer-width'), '240')
    assert.equal(capture('owner-width'), '240')
    assert.equal(capture('topbar-title'), 'Mobile UI Session')
    assert.equal(capture('notice-center-delta'), '0', 'connection notice should be viewport-centered')
    assert.equal(capture('notice-in-header'), 'false', 'connection notice should not occupy the topbar')
    assert.equal(capture('notice-title-visible'), 'true', 'session title should remain visible')
    assert.equal(capture('header-single-row'), 'true', 'header centers: ' + capture('header-tops'))
    assert.equal(capture('crumb-hidden'), 'none', 'main sessions should keep the original title row without a breadcrumb')
    assert.equal(capture('child-crumb-display'), 'flex', 'active child sessions should expose the official breadcrumb')
    assert.equal(capture('child-crumb-position'), 'fixed', 'active child breadcrumb should use the mobile topbar lane')
    assert.ok(Number(capture('child-crumb-top')) <= 12, 'active child breadcrumb should sit in the topbar')
    assert.equal(capture('fish-hidden'), 'none')
    assert.notEqual(capture('panel-visible'), 'none')
    assert.equal(capture('codex-closed-left'), '360', 'Codex should leave the viewport through the right edge')
    assert.equal(capture('codex-closed-top'), '0', 'Codex should not use the bottom-sheet path')
    assert.equal(capture('codex-width'), '360')
    assert.equal(capture('codex-toggle-width'), '40', 'Codex toggle should match the mobile panel touch target')
    assert.equal(capture('codex-toggle-height'), '40', 'Codex toggle should match the mobile panel touch target')
    assert.equal(capture('codex-icon-width'), '24', 'Codex icon should be enlarged to the panel icon size')
    assert.equal(capture('codex-icon-height'), '24', 'Codex icon should be enlarged to the panel icon size')
    assert.equal(capture('codex-icon-transform'), 'matrix(-1, 0, 0, 1, 0, 0)', 'Codex icon should mirror toward the right drawer')
    assert.equal(capture('codex-center-delta'), '0', 'Codex toggle should share the topbar icon centerline: ' + chrome.stdout.match(/<body[^>]*>/)?.[0])
    assert.equal(capture('codex-root-border-bottom'), '0px')
    assert.equal(capture('codex-root-border-left'), '0px')
    assert.equal(capture('codex-tabbar-border-bottom'), '0px')
    assert.equal(capture('codex-sheet-pad-bottom'), '0px', 'the Codex drawer must not keep a safe-area bottom strip behind the content')
    assert.equal(capture('codex-sheet-bg'), 'rgb(255, 255, 255)', 'the sheet background must blend with the Codex tabbar fill')
    assert.equal(capture('toggle-hover-ungated'), 'false', 'the Codex toggle must not keep a hover block after a tap')
    assert.equal(capture('laggy-sheet-visibility'), 'hidden', 'an open Codex drawer with no content yet must not slide out blank')
    assert.equal(capture('laggy-sheet-transform'), 'matrix(1, 0, 0, 1, 360, 0)', 'the pending Codex drawer waits parked one width past the right edge')
    assert.match(capture('subagent-copy-en') ?? '', /Subs/)
    assert.match(capture('job-copy-en') ?? '', /Jobs/)
    assert.match(capture('subagent-copy-zh') ?? '', /子代/)
    assert.match(capture('job-copy-zh') ?? '', /命令/)
    assert.match(capture('mode-text') ?? '', /Standard mode/)
    assert.equal(capture('mode-font-size'), '12px')
    assert.equal(capture('mode-max-width'), '82px')
    assert.match(capture('trace-copy-en') ?? '', /Trace/)
    assert.match(capture('log-copy') ?? '', /Log/)
    assert.equal(capture('chat-padding'), '16px')
    assert.equal(capture('subagent-menu-position'), 'fixed')
    assert.equal(capture('job-menu-position'), 'fixed')
    assert.equal(capture('header-fits'), 'true', 'header bounds: ' + capture('header-widths'))
    assert.equal(capture('header-left-inset'), '16', 'tablist should use the mobile content inset')
    assert.equal(capture('header-right-inset'), '16', 'Log should use the mobile content inset')
    assert.equal(capture('action-justify'), 'flex-start', 'mode/actions should stay grouped')
    assert.equal(capture('action-gap'), '8px', 'mode/actions should have a readable gap')
    assert.ok(Number(capture('mode-subagent-gap')) >= 0 && Number(capture('mode-subagent-gap')) <= 12, 'subagents should follow the mode')
    assert.ok(Number(capture('subagent-job-gap')) >= 0 && Number(capture('subagent-job-gap')) <= 12, 'jobs should follow subagents')
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
})
