import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { mountProgressScreen } from '../src/progress-screen.ts'

test('progress screen is a full-viewport centered spinner status', async () => {
  const source = await readFile(new URL('../src/progress-screen.ts', import.meta.url), 'utf8')
  assert.ok(source.includes('position: fixed'))
  assert.ok(source.includes('align-items: center'))
  assert.ok(source.includes('justify-content: center'))
  assert.ok(source.includes('dsh-progress-spinner'))
  assert.ok(source.includes('@keyframes dsh-progress-spin'))
  assert.ok(source.includes('export function mountProgressScreen'))
})

function fakeElement(tagName) {
  return {
    tagName,
    dataset: {},
    className: '',
    textContent: '',
    children: [],
    append(...nodes) { this.children.push(...nodes) },
    replaceChildren(...nodes) { this.children = nodes },
    setAttribute() {},
  }
}

function withFakeDocument(run) {
  const prior = globalThis.document
  const head = fakeElement('head')
  globalThis.document = {
    head,
    documentElement: fakeElement('html'),
    getElementById: () => null,
    createElement: tagName => fakeElement(tagName),
  }
  try { return run() } finally {
    if (prior === undefined) delete globalThis.document
    else globalThis.document = prior
  }
}

test('mounting a progress screen destroys whatever already owns the shell root', () => {
  withFakeDocument(() => {
    const root = fakeElement('div')
    const bootedShell = fakeElement('div')
    root.append(bootedShell)
    mountProgressScreen(root, { title: '正在加载', spinning: true })
    // This is why main.ts must not repaint while AppWebEntry is booting: a
    // half-mounted shell would be replaced by a spinner that never clears.
    assert.equal(root.children.length, 1)
    assert.equal(root.children.includes(bootedShell), false)
    assert.equal(root.children[0].dataset.mobileProgress, '')
  })
})

test('the shell root is off limits to status repaints while AppWebEntry boots', async () => {
  const source = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
  // The guard must be entered before render() can reach mountProgressScreen.
  assert.match(source, /const render = \(\): void => \{\s+\/\/[^\n]*\n(?:\s+\/\/[^\n]*\n)*\s+if \(shellRootIsPainting\(\)\) return/)
  // bootDshShell owns the root for its whole lifetime, nested fallback included.
  assert.match(source, /shellPaintDepth \+= 1\s+try \{/)
  assert.match(source, /\} finally \{\s+shellPaintDepth -= 1\s+\}/)
  // No await may sit between a finished paint and the flag that protects it.
  assert.match(source, /const booted = await bootDshShell\(selection\)\s+(?:\/\/[^\n]*\n\s+)*shellMounted = true/)
})
