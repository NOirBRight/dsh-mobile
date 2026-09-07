import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'vite'

const fixtureRoot = resolve(import.meta.dirname, 'fixtures/mobile-layout')

test('mobile layout bundle disables the official root before registering its replacement', async () => {
  const patch = await readFile(resolve(import.meta.dirname, '../../../packages/ui-layout-mobile/cordis.patch.yml'), 'utf8')
  assert.match(patch, /^- id: ui-layout\n  disabled: true$/m)
  assert.match(patch, /^    - id: mobile-ui-layout\n      name: '@dsh-mobile\/ui-layout-mobile'$/m)
})

test('mobile layout declares sessions used by preset and model adapters', async () => {
  const source = await readFile(resolve(import.meta.dirname, '../../../packages/ui-layout-mobile/src/client/index.ts'), 'utf8')
  assert.match(source, /export const inject = .*'sessions'/)
})

test('mobile layout does not paginate older history during session changes', async () => {
  const source = await readFile(resolve(import.meta.dirname, '../../../packages/ui-layout-mobile/src/client/index.ts'), 'utf8')
  assert.doesNotMatch(source, /history-prefetch|loadOlder/, 'session changes must not start background history pagination')
})

test('narrow layout replaces composer dock stats and does not wrap the official line', async () => {
  const source = await readFile(resolve(import.meta.dirname, '../../../packages/ui-layout-mobile/src/client/index.ts'), 'utf8')
  const statsRegistration = source.match(/name: 'conversation\.composer\.dock',[\s\S]*?\}, CompactStatsLine/)?.[0]
  assert.ok(statsRegistration, 'mobile compact stats registration is missing')
  assert.match(statsRegistration, /id: 'stats'/)
  assert.match(statsRegistration, /order: 0/)
  assert.match(statsRegistration, /priority: -1/, 'mobile stats must shadow official stats at priority 0 instead of duplicating its identity and priority')
  const css = await readFile(resolve(import.meta.dirname, '../../../packages/ui-layout-mobile/src/client/MobileFrame.module.css'), 'utf8')
  assert.doesNotMatch(css, /\[data-composer-card\]\) ~ div/)
  assert.match(css, /\[data-turn-tail\] \[class\*="timeEnd"\]/)
  assert.doesNotMatch(css, /max-width: min\(52vw/, 'turn-tail metrics must not be silently ellipsized on mobile')
  const modelTrigger = css.match(/button\[aria-label\^="Select model"\][^}]*\{([^}]*)\}/s)?.[1]
  assert.ok(modelTrigger, 'mobile layout must own a semantic model trigger selector after the upstream aria-haspopup change')
  assert.match(modelTrigger, /white-space:\s*nowrap/)
  assert.match(modelTrigger, /overflow:\s*hidden/)
  assert.match(modelTrigger, /text-overflow:\s*ellipsis/)
  const narrowCap = css.match(/@media\s*\(max-width:\s*359px\)\s*\{\s*:global\([^)]*\)\s*\{([^}]*)\}/s)?.[1]
  assert.ok(narrowCap, 'mobile layout must cap the model trigger below 360px viewports (headless floor is 500px, so this branch is pinned statically)')
  assert.match(narrowCap, /max-width:\s*9rem/)
  assert.match(narrowCap, /width:\s*auto/)
  assert.doesNotMatch(
    css,
    /button\[aria-haspopup="menu"\]\s*\+\s*\[role="menu"\]/,
    'model popup geometry must have one JS owner instead of a competing CSS transform',
  )
  const composerScroll = css.match(/\[data-input-scroll\][^}]*\{([^}]*)\}/s)?.[1]
  assert.ok(composerScroll, 'mobile layout must target the official composer scrollport semantically')
  assert.match(composerScroll, /scrollbar-width:\s*none/, 'an empty composer must not paint a permanent scrollbar')
  assert.match(css, /\[data-input-scroll\]::\-webkit-scrollbar/, 'Android WebView needs the WebKit scrollbar suppression')
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
    assert.ok(Number(capture('child-crumb-top')) <= 12, 'active English child breadcrumb should sit in the topbar')
    assert.equal(capture('child-session-title-display'), 'none', 'the scalar title must yield to the complete child breadcrumb')
    assert.equal(capture('child-crumb-position-zh'), 'fixed', 'Chinese child semantics must keep the same topbar placement')
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
    assert.match(capture('job-copy-zh') ?? '', /后台/)
    assert.equal(capture('subagent-copy-display'), 'inline-block')
    assert.equal(capture('subagent-copy-line-height'), '18px')
    assert.equal(capture('job-copy-display'), 'inline-block')
    assert.equal(capture('job-copy-line-height'), '18px')
    assert.equal(capture('mode-text'), 'PTC')
    assert.equal(capture('hero-mode-text'), 'PTC')
    assert.equal(capture('mode-text-zh'), 'PTC')
    assert.equal(capture('mode-font-size'), '12px')
    assert.equal(capture('mode-max-width'), '82px')
    assert.equal(capture('trajectory-text'), 'Trajectory')
    assert.ok(Number.parseFloat(capture('trajectory-font-size') ?? '0') >= 13)
    assert.match(capture('log-copy') ?? '', /Log/)
    assert.equal(capture('chat-padding'), '16px')
    assert.equal(capture('command-option-owned'), 'true', 'mobile composer focus adapter must not claim listbox options')
    assert.equal(capture('compact-stats-text'), 'TTFT 9.9s · 68 tok/s · 缓存命中率 80% · ↑120K ↓9.2K')
    assert.equal(capture('compact-stats-fits'), 'true', 'all approved stats values must remain visible at 320px')
    assert.equal(capture('permission-compact-label'), 'Workspace', 'Workspace Write should use the untruncated mobile label Workspace')
    assert.equal(capture('plan-control-gap'), '4', 'Plan control should move left beside the add control')
    assert.equal(capture('model-long-text'), 'Gemini 3.8 Flash', 'long model label must survive the permission presenter untouched')
    const modelWidth390 = Number(capture('model-long-width'))
    assert.ok(modelWidth390 > 144 && modelWidth390 <= 160, 'long model label should render full past the narrow cap at 390px: ' + modelWidth390)
    assert.equal(capture('model-long-fits'), 'true', 'Gemini 3.8 Flash must render untruncated at 390px')
    const modelWidth360 = Number(capture('model-med-width'))
    assert.ok(modelWidth360 > 144 && modelWidth360 <= 160, 'long model label should render full past the narrow cap at 360px: ' + modelWidth360)
    assert.equal(capture('model-med-fits'), 'true', 'Gemini 3.8 Flash must render untruncated at 360px')
    assert.equal(capture('composer-fit360'), 'true', 'Plan, model, and context controls must not overlap at 360px')
    assert.equal(capture('composer-fit390'), 'true', 'Plan, model, and context controls must not overlap at 390px')
    assert.equal(capture('turn-tail-summary'), '23:41 · 15s · 72 tok/s', 'turn tail must omit TTFT and verbose duration copy')
    assert.equal(capture('model-search-fits'), 'true', 'search field must not clip its card controls')
    assert.equal(capture('model-detail'), '272K', 'mobile model rows must omit redundant Standard copy')
    assert.equal(capture('question-footer-fits'), 'true', 'question footer controls must fit at 320px')
    assert.equal(capture('question-action-equal'), 'true', 'Skip and Next must use equal mobile columns')
    assert.equal(capture('question-matrix'), 'phone320:true,official:true,phone390:true,phone412:true', 'question footer matrix must cover 320/360/390/412 with visible zh/en feedback')
    assert.equal(capture('subagent-menu-position'), 'fixed')
    assert.equal(capture('job-menu-position'), 'fixed')
    assert.equal(capture('header-fits'), 'true', 'header bounds: ' + capture('header-widths'))
    assert.equal(capture('header-left-inset'), '8', 'tablist should use the compact mobile content inset')
    assert.equal(capture('header-right-inset'), '8', 'Log should use the compact mobile content inset')
    assert.equal(capture('action-justify'), 'flex-start', 'mode/actions should stay grouped')
    assert.equal(capture('action-gap'), '4px', 'mode/actions should preserve labels before adding whitespace')
    assert.ok(Number(capture('mode-subagent-gap')) >= 0 && Number(capture('mode-subagent-gap')) <= 12, 'subagents should follow the mode')
    assert.ok(Number(capture('subagent-job-gap')) >= 0 && Number(capture('subagent-job-gap')) <= 12, 'jobs should follow subagents')
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
})

test('composer toolbar does not overlap at a real 320px viewport', async () => {
  // --dump-dom Chrome floors the viewport at 500px, so this check drives a
  // real 320px viewport through CDP device emulation (the same mechanism as
  // the DevTools device toolbar): window.innerWidth truthfully reports 320
  // and the max-width:359px branch genuinely applies. No faked innerWidth.
  const outDir = await mkdtemp(join(tmpdir(), 'dsh-mobile-320-'))
  let chrome = null
  try {
    await build({ root: fixtureRoot, base: './', configFile: false, logLevel: 'silent', build: { outDir, emptyOutDir: true } })
    const port = await new Promise((settle, reject) => {
      const probe = createServer()
      probe.on('error', reject)
      probe.listen(0, '127.0.0.1', () => {
        const { port: free } = probe.address()
        probe.close(() => settle(free))
      })
    })
    chrome = spawn(process.env.CHROME_BIN ?? '/usr/bin/google-chrome', [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--allow-file-access-from-files',
      `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', 'about:blank',
    ], { stdio: ['ignore', 'ignore', 'ignore'] })
    const deadline = Date.now() + 15_000
    let debuggerUrl = null
    while (debuggerUrl === null) {
      if (Date.now() > deadline) throw new Error('remote debugging endpoint did not come up')
      await new Promise((r) => setTimeout(r, 200))
      try {
        const created = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json()
        debuggerUrl = created.webSocketDebuggerUrl ?? null
      } catch { /* chrome still starting */ }
    }
    const socket = new WebSocket(debuggerUrl)
    await new Promise((settle, reject) => {
      socket.onopen = settle
      socket.onerror = () => reject(new Error('CDP socket failed to open'))
    })
    try {
      let id = 0
      const pending = new Map()
      socket.onmessage = (event) => {
        const message = JSON.parse(String(event.data))
        if (message.id !== undefined && pending.has(message.id)) {
          pending.get(message.id)(message)
          pending.delete(message.id)
        }
      }
      const send = (method, params = {}) => new Promise((settle) => {
        id += 1
        pending.set(id, settle)
        socket.send(JSON.stringify({ id, method, params }))
      })
      const emulated = await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 800, deviceScaleFactor: 1, mobile: true, screenWidth: 320, screenHeight: 800 })
      assert.ok(emulated.result !== undefined, 'CDP device emulation must apply: ' + JSON.stringify(emulated))
      await send('Page.navigate', { url: 'file://' + resolve(outDir, 'index.html') })
      const read = (expression) => send('Runtime.evaluate', { expression, returnByValue: true })
        .then((reply) => reply.result?.result?.value)
      let ready = null
      while (ready !== 'true') {
        if (Date.now() > deadline) throw new Error('320px fixture did not settle')
        await new Promise((r) => setTimeout(r, 250))
        ready = await read('document.body.dataset.ready ?? ""')
      }
      const probe = await read('JSON.stringify({ vv: window.visualViewport ? window.visualViewport.width : -1, scr: window.screen.width, mq359: matchMedia("(max-width: 359px)").matches, fit320: document.body.dataset.composerFit320, maxWidth320: document.body.dataset.model320MaxWidth })')
      const seen = JSON.parse(probe)
      assert.equal(seen.vv, 320, 'the visual viewport must truthfully measure 320px, not a stubbed value')
      assert.equal(seen.scr, 320, 'the emulated screen must report 320px')
      assert.equal(seen.mq359, true, 'the below-360px 9rem branch must genuinely apply at 320px')
      assert.equal(seen.maxWidth320, '144px', 'the 320px model trigger must render under the 9rem cap')
      assert.equal(seen.fit320, 'true', 'Plan, model, and context controls must not overlap at 320px')
    } finally {
      socket.close()
    }
  } finally {
    chrome?.kill('SIGKILL')
    await rm(outDir, { recursive: true, force: true })
  }
})
