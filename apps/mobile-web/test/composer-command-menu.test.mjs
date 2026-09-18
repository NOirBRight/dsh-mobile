import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { build } from 'vite'

const fixtureRoot = resolve(import.meta.dirname, 'fixtures/composer-command-menu')

test('narrow plus opens the official command listbox with the File row visible', async () => {
  const outDir = await mkdtemp(join(tmpdir(), 'dsh-composer-command-menu-'))
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
            import.meta.dirname,
            '../../../.dsh-upstream/packages/client/ui-primitives/src/index.ts',
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
    assert.match(chrome.stdout, /data-ready="true"/, 'command-menu fixture did not settle: ' + chrome.stderr)
    const capture = (name) => new RegExp('data-' + name + '="([^"]*)"').exec(chrome.stdout)?.[1] ?? ''
    assert.equal(capture('zh-plus-label'), '添加文件或调用指令')
    assert.equal(capture('en-plus-label'), 'Add files or run commands')
    assert.equal(capture('zh-attach-menu'), '', 'phone plus must not open a second-layer attach menu')
    assert.equal(capture('en-attach-menu'), '')
    assert.match(capture('zh-listbox'), /文件/)
    assert.match(capture('zh-listbox'), /目标/)
    assert.match(capture('en-listbox'), /File/)
    assert.match(capture('en-listbox'), /Goal/)
    assert.equal(capture('zh-file-hidden'), '', 'Chinese 文件 row must stay visible')
    assert.notEqual(capture('zh-file-display'), 'none')
    assert.match(capture('zh-file-label'), /文件/)
    assert.equal(capture('zh-goal-hidden'), '')
    assert.notEqual(capture('zh-goal-display'), 'none')
    assert.equal(capture('en-file-hidden'), '', 'English File row must stay visible')
    assert.notEqual(capture('en-file-display'), 'none')
    assert.match(capture('en-file-label'), /File/)
    assert.equal(capture('en-goal-hidden'), '')
    assert.notEqual(capture('en-goal-display'), 'none')
    assert.equal(capture('desk-file-hidden'), '')
    assert.notEqual(capture('desk-file-display'), 'none')
    assert.match(capture('desk-file-label'), /File/)
    assert.match(capture('desk-listbox'), /File/)
    assert.equal(capture('zh-file-cube'), '', 'official SVG rows must not get a second cube')
    assert.equal(capture('zh-ponytail-cube'), 'cube')
    assert.equal(capture('zh-skill-cube'), 'cube')
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
})
