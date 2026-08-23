import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { installRemoteNavIcon, recordsTouchSettingsNav } from '../src/client/nav-icon.ts'

const original = {
  Element: globalThis.Element,
  MutationObserver: globalThis.MutationObserver,
  requestAnimationFrame: globalThis.requestAnimationFrame,
  cancelAnimationFrame: globalThis.cancelAnimationFrame,
  document: globalThis.document,
}

afterEach(() => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete globalThis[key]
    else globalThis[key] = value
  }
})

class FakeEl {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase()
    this.parentElement = null
    this.children = []
    this.textContent = ''
    this.innerHTML = ''
    this.attrs = new Map()
  }
  setAttribute(name, value) { this.attrs.set(name, value) }
  getAttribute(name) { return this.attrs.get(name) ?? null }
  append(...nodes) {
    for (const node of nodes) {
      node.parentElement = this
      this.children.push(node)
    }
  }
  matches(selector) {
    if (selector.includes(' ')) return false
    return this.tagName === String(selector).toUpperCase()
  }
  closest(selector) {
    let current = this
    while (current) {
      if (current.matches(selector)) return current
      current = current.parentElement
    }
    return null
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null }
  querySelectorAll(selector) {
    const found = []
    const visit = (node) => {
      for (const child of node.children) {
        if (child.matches(selector) || (selector === 'nav button' && child.tagName === 'BUTTON' && child.closest('nav'))) found.push(child)
        visit(child)
      }
    }
    visit(this)
    return found
  }
}

class FakeObserver {
  static instances = []
  constructor(callback) {
    this.callback = callback
    this.disconnected = false
    this.takeCount = 0
    FakeObserver.instances.push(this)
  }
  observe() { this.disconnected = false }
  disconnect() { this.disconnected = true }
  takeRecords() { this.takeCount += 1; return [] }
  deliver(records) { this.callback(records, this) }
}

function record(target, added = []) {
  return { type: 'childList', target, addedNodes: added, removedNodes: [] }
}

function labeledButton(text) {
  const nav = new FakeEl('nav')
  const button = new FakeEl('button')
  const span = new FakeEl('span')
  span.textContent = text
  const svg = new FakeEl('svg')
  button.append(span, svg)
  nav.append(button)
  return nav
}

function stubDom(buttons = []) {
  FakeObserver.instances = []
  const rafs = []
  globalThis.Element = FakeEl
  globalThis.MutationObserver = FakeObserver
  globalThis.requestAnimationFrame = (cb) => { rafs.push(cb); return rafs.length }
  globalThis.cancelAnimationFrame = (id) => { rafs[id - 1] = () => {} }
  globalThis.document = {
    body: {},
    querySelectorAll: (selector) => selector === 'nav button' ? buttons : [],
  }
  return {
    rafs,
    flush() {
      const queued = rafs.splice(0, rafs.length)
      for (const cb of queued) cb(0)
    },
  }
}

test('conversation subtree records do not touch the Remote nav', () => {
  globalThis.Element = FakeEl
  const chat = new FakeEl('div')
  const line = new FakeEl('span')
  line.textContent = 'hello'
  chat.append(line)
  assert.equal(recordsTouchSettingsNav([record(chat)]), false)
})

test('inserting the Remote nav button is relevant', () => {
  globalThis.Element = FakeEl
  const dialog = new FakeEl('div')
  dialog.append(labeledButton('远程'))
  assert.equal(recordsTouchSettingsNav([record(new FakeEl('body'), [dialog])]), true)
})

test('conversation mutations do not schedule a RAF', () => {
  const { rafs } = stubDom()
  installRemoteNavIcon()
  FakeObserver.instances[0].deliver([record(new FakeEl('div'))])
  assert.equal(rafs.length, 0)
})

test('a labeled-nav burst coalesces to one patch and drains self-records', () => {
  const nav = labeledButton('Remote')
  const button = nav.children[0]
  const buttons = []
  const { rafs, flush } = stubDom(buttons)
  installRemoteNavIcon()
  const observer = FakeObserver.instances[0]
  buttons.push(button)
  observer.deliver([record(nav)])
  observer.deliver([record(nav)])
  observer.deliver([record(nav)])
  assert.equal(rafs.length, 1)
  flush()
  assert.ok(observer.takeCount > 0)
  assert.equal(button.children[1].getAttribute('data-dsh-remote-icon'), 'remote')
})

test('dispose disconnects and cancels a pending frame', () => {
  const { rafs, flush } = stubDom()
  const stop = installRemoteNavIcon()
  FakeObserver.instances[0].deliver([record(labeledButton('Remote'))])
  assert.equal(rafs.length, 1)
  stop()
  assert.equal(FakeObserver.instances[0].disconnected, true)
  flush()
})
