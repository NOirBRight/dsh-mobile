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
  const el = {
    tagName,
    dataset: {},
    className: '',
    textContent: '',
    children: [],
    style: { props: {}, setProperty(k, v) { this.props[k] = v }, removeProperty(k) { delete this.props[k] } },
    get firstElementChild() { return this.children[0] ?? null },
    append(...nodes) { this.children.push(...nodes) },
    prepend(...nodes) { this.children.unshift(...nodes) },
    replaceChildren(...nodes) { this.children = nodes },
    setAttribute() {},
    removeAttribute() {},
    remove() {},
    querySelector(sel) {
      if (sel === '[data-mobile-progress]') return this.children.find(c => Object.prototype.hasOwnProperty.call(c.dataset, 'mobileProgress')) ?? null
      if (sel.startsWith('.')) {
        const cls = sel.slice(1)
        const walk = nodes => {
          for (const n of nodes) {
            if (n.className === cls) return n
            const hit = walk(n.children ?? [])
            if (hit) return hit
          }
          return null
        }
        return walk(this.children)
      }
      return null
    },
  }
  return el
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

test('plugin-load ticks reuse the ring and set a determinate arc', () => {
  withFakeDocument(() => {
    const root = fakeElement('div')
    const first = mountProgressScreen(root, { title: '正在加载', spinning: true, ratio: 0 })
    const spinner = first.children[0].querySelector('.dsh-progress-spinner')
    const second = mountProgressScreen(root, { title: '正在加载', detail: '正在拉取 Host 界面 3/10…', spinning: true, ratio: 0.3 })
    assert.equal(second, first)
    assert.equal(second.children[0].querySelector('.dsh-progress-spinner'), spinner)
    assert.equal(spinner.style.props['--dsh-progress-arc'], '108deg')
    assert.equal(Object.prototype.hasOwnProperty.call(spinner.dataset, 'determinate'), true)
  })
})

test('the shell root is off limits to status repaints while AppWebEntry boots', async () => {
  const source = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
  // The guard must be entered before render() can reach mountProgressScreen.
  assert.match(source, /const render = \(\): void => \{\s+\/\/[^\n]*\n(?:\s+\/\/[^\n]*\n)*\s+if \(shellRootIsPainting\(\)\) return/)
  // bootDshShell owns the root for its whole lifetime, nested fallback included.
  assert.match(source, /shellPaintDepth \+= 1[\s\S]*?try \{/)
  assert.match(source, /\} finally \{\s+window.clearTimeout\(recoveryTimer\)\s+recovery.remove\(\)\s+shellPaintDepth -= 1\s+\}/)
  assert.match(source, /await runDshClient\(entry\)/, 'mobile shell must receive AppWebEntry plugin failures')
  assert.match(source, /entry\.dispose\(\)/, 'failed Host entries must be disposed before recovery')
  // No await may sit between a finished paint and the flag that protects it.
  assert.match(source, /const booted = await bootDshShell\(selection\)\s+(?:\/\/[^\n]*\n\s+)*shellMounted = true/)
})
