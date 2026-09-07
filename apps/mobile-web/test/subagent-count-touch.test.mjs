import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { build } from 'vite'

const fixtureRoot = resolve(import.meta.dirname, 'fixtures/subagent-count-touch')
const upstreamRoot = resolve(import.meta.dirname, '..', '..', '..', '.dsh-upstream')

test('touch tap opens the subagent count catalog through the public ArrowDown path', async () => {
  const outDir = await mkdtemp(join(tmpdir(), 'dsh-subagent-count-touch-'))
  try {
    await build({
      root: fixtureRoot,
      base: './',
      configFile: false,
      logLevel: 'silent',
      resolve: {
        dedupe: ['react', 'react-dom'],
        alias: {
          '@deepseek-ai/dsh-client-ui-primitives': resolve(
            upstreamRoot,
            'packages/client/ui-primitives/src/index.ts',
          ),
        },
      },
      build: { outDir, emptyOutDir: true },
    })
    const chrome = spawnSync(process.env.CHROME_BIN ?? '/usr/bin/google-chrome', [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--allow-file-access-from-files',
      '--window-size=360,800', '--virtual-time-budget=4000', '--dump-dom', 'file://' + resolve(outDir, 'index.html'),
    ], { encoding: 'utf8', timeout: 20_000 })
    assert.equal(chrome.status, 0, chrome.stderr)
    assert.match(chrome.stdout, /data-ready="true"/, 'touch fixture did not settle: ' + chrome.stderr)
    const capture = (name) => new RegExp('data-' + name + '="([^"]*)"').exec(chrome.stdout)?.[1] ?? ''
    const unescape = (value) => value.replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    // Upstream contract: the count trigger exposes the lineage count, not the switcher.
    assert.equal(unescape(capture('count-aria')), '1 \u4e2a\u5b50\u4ee3\u7406')
    assert.match(unescape(capture('switcher-aria')), /^\u5207\u6362\u5b50\u4ee3\u7406\uff1a/)
    // A plain mouse click is a documented no-op for the count variant (no onClick).
    assert.equal(capture('click-expanded'), 'false')
    assert.equal(capture('click-trees'), '0')
    // The public keyboard opener works and lists the completed continuable child.
    assert.equal(capture('arrow-expanded'), 'true')
    assert.equal(capture('arrow-trees'), '1')
    assert.match(unescape(capture('arrow-row')), /Child QA acceptance task/)
    assert.match(unescape(capture('arrow-row')), /\u5f53\u524d\u672a\u8fd0\u884c/)
    assert.equal(capture('after-escape-trees'), '0')
    // A genuine touch tap must open the same catalog without any Core change.
    assert.equal(capture('touch-expanded'), 'true')
    assert.equal(capture('touch-trees'), '1')
    assert.match(unescape(capture('touch-row')), /Child QA acceptance task/)
    // The official row handler navigates with the exact child address.
    assert.deepEqual(JSON.parse(unescape(capture('open-child'))), {
      parentSessionId: 'parent',
      childSessionId: 'child-1',
      mode: 'continuable',
    })
    assert.equal(capture('after-row-trees'), '0')
    // A current-child switcher carries no openTitle, so touch opens its menu
    // through the same public ArrowDown path (existing behavior, not a hijack).
    assert.equal(capture('switcher-expanded'), 'true')
    assert.equal(capture('switcher-trees'), '1')
    assert.match(unescape(capture('switcher-row')), /Child QA acceptance task/)
    assert.equal(capture('after-switcher-escape-trees'), '0')
    // An ancestor switcher tap navigates: the seat re-roots onto the parent
    // and unmounts the previous catalog, leaving no stray menu behind.
    assert.equal(capture('ancestor-nav'), 'true')
    assert.equal(capture('ancestor-seat'), 'parent')
    assert.equal(unescape(capture('ancestor-seat-aria')), '1 \u4e2a\u5b50\u4ee3\u7406')
    assert.equal(capture('after-ancestor-trees'), '0')
    assert.equal(capture('open-child-count'), '1')
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
})
