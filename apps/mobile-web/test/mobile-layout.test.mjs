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

test('opening the drawer dismisses Agent Team instead of hiding it', async () => {
  const source = await readFile(resolve(import.meta.dirname, '../../../packages/ui-layout-mobile/src/client/MobileFrame.tsx'), 'utf8')
  assert.match(source, /dismissOfficialTeamDialog/, 'drawer open must close Agent Team through its official trigger')
})

test('narrow layout lets official StatsPills occupy the composer dock', async () => {
  const source = await readFile(resolve(import.meta.dirname, '../../../packages/ui-layout-mobile/src/client/index.ts'), 'utf8')
  assert.doesNotMatch(source, /CompactStatsLine/, 'mobile must not shadow official stats')
  assert.match(source, /'main': \{ kind: 'keyed'/)
  assert.match(source, /'rightbar': \{ kind: 'single'/)
  const css = await readFile(resolve(import.meta.dirname, '../../../packages/ui-layout-mobile/src/client/MobileFrame.module.css'), 'utf8')
  assert.doesNotMatch(css, /\[data-composer-card\]\) ~ div/)
  assert.match(css, /\[data-turn-tail\] \[class\*="timeEnd"\]/)
  assert.doesNotMatch(css, /max-width: min\(52vw/, 'turn-tail metrics must not be silently ellipsized on mobile')
  const modelTrigger = css.match(/button\[aria-label\^="Select model"\][^}]*\{([^}]*)\}/s)?.[1]
  assert.ok(modelTrigger, 'mobile layout must own a semantic model trigger selector after the upstream aria-haspopup change')
  assert.match(modelTrigger, /white-space:\s*nowrap/)
  assert.match(modelTrigger, /overflow:\s*hidden/)
  assert.match(modelTrigger, /text-overflow:\s*ellipsis/)
  assert.doesNotMatch(css, /max-width:\s*9rem/, 'icon chrome leaves the model trigger uncapped so the name uses leftover width')
  assert.match(css, /\[data-mobile-permission-trigger\]/)
  assert.match(css, /\[data-mobile-model-trigger\]/)
  assert.match(css, /\[data-conversation-header-leading\]/, 'alpha.2 darwin leading chrome must leave the phone header')
  assert.match(css, /\[data-settings-panel\]/, 'settings recomposition must not depend on :has()')
  assert.match(css, /\[data-team-action\] > button/, 'Team trigger restyle must not hit roster buttons')
  assert.match(css, /\[data-team-action\]\) :global\(\[role="dialog"\]\)/, 'Agent Team popover must reflow without :has()')
  assert.match(css, /\[data-drawer-open\].*\[data-team-action\] > button/s, 'open drawer must hide the Team trigger, not CSS-hide the popover')
  assert.match(css, /\[data-drawer-open\] \.center :global\(header\)/, 'open drawer must drop the Team header lift so Chat does not paint through the sidebar')
  assert.match(css, /\[data-team-open\]/, 'Agent Team popover stacking must not depend on :has() alone')
  assert.match(css, /\[data-mobile-settings-row\]/, 'drawer footer must wrap the connection pill below Settings/Switch')
  assert.match(css, /button\[data-mobile-new-session\]/, 'New session hit target must key a stamped seam, not a hashed class')
  assert.match(css, /\[data-mobile-new-session-label\]/, 'New session label must keep the official text box')
  assert.match(css, /\[data-mobile-brand\]/, 'official brand leftover width must key a stamp, not a hashed class')
  assert.match(css, /\[data-mobile-wordmark\]/, 'DeepSeek Harness wordmark size must key a stamp, not svg width')
  assert.doesNotMatch(css, /\[class\*="brand"\]/)
  assert.doesNotMatch(css, /svg\[width="156"\]/)
  assert.doesNotMatch(css, /svg\[width="182"\]\s*~\s*svg\[width="24"\]/, 'do not hide the official 24px mark beside a wordmark')
  assert.match(css, /\[data-mobile-panel-row\]/, 'official sidebar panel rows must grow to a phone hit target')
  assert.doesNotMatch(css, /\[class\*="panelRow"\]/)
  assert.doesNotMatch(css, /\[class\*="triggerRow"\]/)
  assert.match(css, /\[data-mobile-team-roster\]/, 'Agent Team members must stack to one column on a phone')
  assert.doesNotMatch(css, /min-height:\s*100vh/, 'Agent Team must stay a popover, not a fullscreen sheet')
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
    assert.ok(Number(capture('sidebar-new-session-height')) >= 44, 'official New session must be a phone hit target, got height ' + capture('sidebar-new-session-height'))
    assert.ok(Number(capture('sidebar-new-session-height')) <= 48, 'New session must stay a compact pill, got height ' + capture('sidebar-new-session-height'))
    assert.ok(Number(capture('sidebar-new-session-label-height')) <= 24, 'New session label must not inherit the 44px hit target, got height ' + capture('sidebar-new-session-label-height'))
    assert.equal(capture('sidebar-new-session-align'), 'true', 'New session icon and label must share a centerline')
    assert.equal(capture('panel-row-min-height'), '44px', 'sidebar panel rows must grow to a phone hit target')
    assert.equal(capture('settings-row-wrap'), 'wrap', 'Settings footer must wrap the connection pill onto its own line')
    assert.equal(capture('connection-label-ellipsis'), 'ellipsis', 'connection pill copy must ellipsize instead of overflowing the drawer')
    assert.equal(capture('mode-label-stamped'), 'true', 'preset chip must be stamped so CSS does not read hashed header classes')
    assert.equal(capture('header-leading'), 'none', 'alpha.2 darwin header leading must not occupy the phone title row')
    assert.ok(Number(capture('sidebar-occupant-height')) > 40, 'the sidebar occupant must fill the drawer, got height ' + capture('sidebar-occupant-height'))
    assert.equal(capture('official-drawer-width'), '280')
    assert.equal(capture('official-owner-width'), '280')
    assert.equal(capture('drawer-width'), '240')
    assert.equal(capture('owner-width'), '240')
    assert.equal(capture('topbar-title'), 'Mobile UI Session')
    assert.equal(capture('notice-center-delta'), '0', 'connection notice should be viewport-centered')
    assert.equal(capture('notice-in-header'), 'false', 'connection notice should not occupy the topbar')
    assert.equal(capture('notice-title-visible'), 'true', 'session title should remain visible')
    assert.equal(capture('more-button'), 'false', 'mobile topbar does not keep a leftover-actions menu')
    assert.equal(capture('rightbar-expand'), 'true', 'official rightbar expand should remain in the tree')
    assert.equal(capture('team-drawer-visibility'), 'hidden', 'open drawer must not leak the Agent Team trigger')
    assert.equal(capture('team-drawer-pointer'), 'none', 'open drawer must not accept Team trigger taps through the scrim')
    assert.equal(capture('expand-drawer-visibility'), 'hidden', 'open drawer must not leak the rightbar expand control')
    assert.equal(capture('team-sheet-position'), 'fixed', 'Agent Team must leave the desktop popover containing block')
    assert.equal(capture('team-sheet-left'), '8px', 'Agent Team popover must inset from the phone left edge')
    assert.equal(capture('team-sheet-right'), '8px', 'Agent Team popover must inset from the phone right edge')
    assert.notEqual(capture('team-sheet-top'), '0px', 'Agent Team popover must sit under the header, got top ' + capture('team-sheet-top'))
    assert.equal(capture('team-sheet-radius'), '12px', 'Agent Team must keep the desktop card radius')
    assert.ok(
      Number(capture('team-sheet-width')) < Number(capture('viewport-width')) - 8,
      'Agent Team popover must inset instead of covering the viewport, got ' + capture('team-sheet-width') + ' vs ' + capture('viewport-width'),
    )
    assert.ok(
      Number(capture('team-sheet-width')) >= Number(capture('viewport-width')) - 40,
      'Agent Team popover must span the phone inset, got ' + capture('team-sheet-width') + ' vs ' + capture('viewport-width'),
    )
    assert.ok(
      Number(capture('team-sheet-height')) < Number(capture('viewport-height')) - 80,
      'Agent Team must keep auto height, got ' + capture('team-sheet-height') + ' vs ' + capture('viewport-height'),
    )
    assert.equal(capture('team-roster-stacked'), 'true', 'Agent Team members must stack one per row')
    assert.equal(capture('team-trigger-open-visibility'), 'visible', 'open Agent Team must keep the header Team trigger')
    assert.notEqual(capture('team-member-font'), '0px', 'Team trigger restyle must not hide Agent Team member names')
    assert.doesNotMatch(capture('team-member-after') ?? '', /Team/, 'member names must not gain a Team ::after, got ' + capture('team-member-after'))
    assert.equal(capture('team-header-z'), '45', 'open Agent Team must lift the conversation header above the composer')
    assert.equal(capture('team-drawer-header-z'), '1', 'opening the drawer after Agent Team must not leave Chat above the sidebar')
    assert.equal(capture('team-dismissed'), 'true', 'opening the drawer must dismiss Agent Team like the model picker')
    assert.equal(capture('open-locally-hidden'), 'none', 'Open locally is unavailable on the phone')
    assert.equal(capture('crumb-hidden'), 'flex', 'parent lineage nav is one of the five row-2 cells')
    assert.equal(capture('child-crumb-display'), 'flex', 'active child sessions should expose the official breadcrumb')
    assert.equal(capture('child-crumb-position'), 'fixed', 'active child breadcrumb should use the mobile topbar lane')
    assert.ok(Number(capture('child-crumb-top')) <= 12, 'active English child breadcrumb should sit in the topbar')
    assert.equal(capture('child-session-title-display'), 'none', 'the scalar title must yield to the complete child breadcrumb')
    assert.equal(capture('child-crumb-position-zh'), 'fixed', 'Chinese child semantics must keep the same topbar placement')
    assert.equal(capture('brand-mark-visible'), 'true', 'official 24px mark stays beside the name wordmark')
    assert.equal(capture('brand-stamped'), 'true', 'official brand shortcut must receive data-mobile-brand')
    assert.equal(capture('brand-not-pill'), 'true', 'brand wordmark must not be stamped as the New Session pill')
    assert.equal(capture('wordmark-stamped'), 'true', 'name wordmark SVG must receive data-mobile-wordmark')
    assert.equal(capture('pill-stamped'), 'true', 'the New Session pill must still receive data-mobile-new-session')
    assert.ok(
      Number(capture('wordmark-width')) >= 150,
      'DeepSeek Harness wordmark must keep its 156px artwork, got width ' + capture('wordmark-width'),
    )
    assert.notEqual(capture('panel-visible'), 'none', 'drawer keeps the official collapse control')
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
    assert.equal(capture('chat-padding'), '16px')
    assert.equal(capture('command-option-owned'), 'true', 'mobile composer focus adapter must not claim listbox options')
    assert.match(capture('compact-stats-text') ?? '', /tok\/s/)
    assert.equal(capture('compact-stats-fits'), 'true', 'official stats pills must remain visible at 320px')
    assert.equal(capture('permission-icon'), 'true', 'permission trigger should collapse to the official glyph')
    assert.equal(capture('permission-haspopup'), 'null', 'official Access mode button has no aria-haspopup')
    assert.equal(capture('permission-extra-hidden'), 'true', 'permission label and chevron should hide on mobile')
    assert.equal(capture('permission-chevron-hidden'), 'true', 'permission chevron computed display must be none on the nested span')
    assert.equal(capture('model-chevron-hidden'), 'true', 'closed model trigger chevron computed display must be none')
    assert.equal(capture('model-haspopup'), 'menu', 'model trigger must keep aria-haspopup')
    assert.equal(capture('model-aria'), 'Select model, current Acme Super Long Custom Model Name That Must Ellipsize · High Effort', 'accessible custom model name stays full')
    assert.equal(capture('context-ring-visible'), 'true', 'official context ring must remain visible')
    assert.equal(capture('plan-control-gap'), '4', 'Plan control should move left beside the add control')
    assert.equal(capture('deepseek-text'), 'DeepSeek V4 Flash Vision (exp)', 'DeepSeek closed label keeps the product name')
    assert.equal(capture('deepseek-aria'), 'Select model, current DeepSeek V4 Flash Vision (exp) · High Effort')
    assert.equal(capture('grok-text'), 'Grok 4.6', 'Grok 4.6 must keep the family name')
    assert.equal(capture('grok-aria'), 'Select model, current Grok 4.6 · High Effort')
    assert.equal(capture('cursor-grok-text'), 'Cursor Grok 4.6')
    assert.equal(capture('cursor-grok-aria'), 'Select model, current Cursor Grok 4.6 · High Effort')
    assert.equal(capture('icon-gaps360'), 'true', 'plus/permission/plan and model/ring/send gaps must be 4px at 360')
    assert.equal(capture('icon-gaps390'), 'true', 'icon cluster gaps must be 4px at 390')
    assert.equal(capture('icon-gaps320'), 'true', 'icon cluster gaps must be 4px at 320')
    assert.equal(capture('plan-hit360'), '28', 'Plan hitbox must stay 28px')
    assert.equal(capture('left-align360'), '0', 'plus must sit on the left edge of the toolbar')
    assert.equal(capture('right-align360'), '0', 'send must sit on the right edge of the toolbar')
    assert.ok(Number(capture('plan-model-gap360')) >= 4, 'Plan must not touch the model pill')
    const modelWidth390 = Number(capture('model-long-width'))
    assert.ok(modelWidth390 > 40 && modelWidth390 < 180, 'Grok 4.6 should size to its label, not leftover row width: ' + modelWidth390)
    assert.equal(capture('model-packed390'), 'true', 'short Grok 4.6 must sit next to the ring, not stretch leftover space')
    assert.equal(capture('model-long-fits'), 'true', 'Grok 4.6 must render untruncated at 390px')
    const modelWidth360 = Number(capture('model-med-width'))
    assert.ok(modelWidth360 > 40 && modelWidth360 < 220, 'DeepSeek compact name should size to its label: ' + modelWidth360)
    assert.equal(capture('model-med-fits'), 'true', 'DeepSeek V4 Flash Vision (exp) may ellipsize but must not drop the vendor')
    assert.equal(capture('composer-fit360'), 'true', 'Plan, model, and context ring must not overlap at 360px')
    assert.equal(capture('composer-fit390'), 'true', 'Plan, model, and context ring must not overlap at 390px')
    assert.equal(capture('turn-tail-summary'), '23:41 · 15s · 72 tok/s', 'turn tail must omit TTFT and verbose duration copy')
    assert.equal(capture('model-search-fits'), 'true', 'search field must not clip its card controls')
    assert.equal(capture('model-detail'), '272K', 'mobile model rows must omit redundant Standard copy')
    assert.equal(capture('question-footer-fits'), 'true', 'question footer controls must fit at 320px')
    assert.equal(capture('question-action-equal'), 'true', 'Skip and Next must use equal mobile columns')
    assert.equal(capture('question-matrix'), 'phone320:true,official:true,phone390:true,phone412:true', 'question footer matrix must cover 320/360/390/412 with visible zh/en feedback')
    assert.equal(capture('subagent-menu-position'), 'fixed')
    assert.equal(capture('job-menu-position'), 'fixed')
    assert.equal(capture('header-fits'), 'true', 'header bounds: ' + capture('header-widths'))
    assert.ok(Number(capture('header-left-inset')) <= 40, 'row-2 left inset: ' + capture('header-left-inset'))
    assert.ok(Number(capture('header-right-inset')) <= 40, 'row-2 right inset: ' + capture('header-right-inset'))
    assert.ok(Number.isFinite(Number(capture('mode-subagent-gap'))), 'mode/subagent geometry captured')
    assert.ok(Number.isFinite(Number(capture('subagent-job-gap'))), 'subagent/job geometry captured')
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
      const probe = await read('JSON.stringify({ vv: window.visualViewport ? window.visualViewport.width : -1, scr: window.screen.width, mq359: matchMedia("(max-width: 359px)").matches, fit320: document.body.dataset.composerFit320, permChevron: document.body.dataset.permissionChevronHidden, modelChevron: document.body.dataset.modelChevronHidden, ring: document.body.dataset.contextRingVisible, gaps: document.body.dataset.iconGaps320, aria: document.body.dataset.modelAria })')
      const seen = JSON.parse(probe)
      assert.equal(seen.vv, 320, 'the visual viewport must truthfully measure 320px, not a stubbed value')
      assert.equal(seen.scr, 320, 'the emulated screen must report 320px')
      assert.equal(seen.mq359, true, 'the 320px viewport must still be below 360px')
      assert.equal(seen.fit320, 'true', 'Plan, model, and context ring must not overlap at 320px')
      assert.equal(seen.permChevron, 'true', 'permission chevron must be computed hidden at 320px')
      assert.equal(seen.modelChevron, 'true', 'model chevron must be computed hidden at 320px')
      assert.equal(seen.ring, 'true', 'official context ring must stay visible at 320px')
      assert.equal(seen.gaps, 'true', 'icon cluster gaps must stay 4px at 320px')
      assert.equal(seen.aria, 'Select model, current Acme Super Long Custom Model Name That Must Ellipsize · High Effort')
    } finally {
      socket.close()
    }
  } finally {
    chrome?.kill('SIGKILL')
    await rm(outDir, { recursive: true, force: true })
  }
})
