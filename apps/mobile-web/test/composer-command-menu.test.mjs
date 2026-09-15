import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { build } from 'vite'

const fixtureRoot = resolve(import.meta.dirname, 'fixtures/composer-command-menu')

test('narrow plus forwards to the official command listbox without a file row; desktop keeps File', async () => {
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
    assert.match(capture('zh-attach-menu'), /命令/)
    assert.match(capture('zh-attach-menu'), /插入图片/)
    assert.doesNotMatch(capture('zh-attach-menu'), /添加文件|File|^文件$/)
    assert.match(capture('en-attach-menu'), /命令/)
    assert.match(capture('en-attach-menu'), /插入图片/)
    assert.doesNotMatch(capture('en-attach-menu'), /Add file/)
    assert.equal(capture('zh-file-hidden'), 'true', 'Chinese 文件 row must hide on the phone')
    assert.equal(capture('zh-file-display'), 'none')
    assert.match(capture('zh-file-label'), /文件/)
    assert.equal(capture('zh-goal-hidden'), '', '目标 stays in the official command list')
    assert.notEqual(capture('zh-goal-display'), 'none')
    assert.equal(capture('en-file-hidden'), 'true', 'English File row must hide on the phone')
    assert.equal(capture('en-file-display'), 'none')
    assert.match(capture('en-file-label'), /File/)
    assert.equal(capture('en-goal-hidden'), '')
    assert.notEqual(capture('en-goal-display'), 'none')
    assert.equal(capture('desk-file-hidden'), '', 'desktop wide must keep the official File row')
    assert.notEqual(capture('desk-file-display'), 'none')
    assert.match(capture('desk-file-label'), /File/)
    assert.equal(capture('desk-goal-hidden'), '')
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
})
