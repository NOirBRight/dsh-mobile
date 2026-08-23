import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CHROME_HEALTH_MESSAGE,
  findConnectionBadgeAnchor,
  findSettingsTrigger,
  inspectChromeAnchors,
  isComposerSendLabel,
  isOfficialNewSessionLabel,
  queryDrawerToggleSlot,
} from '../src/anchors.ts'

function spanButton(label) {
  return {
    querySelectorAll(selector) {
      return selector === 'span' ? [{ textContent: label }] : []
    },
  }
}

function chromeRoot({ title = null, brand = null, newSession = null, settings = [], drawer = null } = {}) {
  const drawerNode = drawer ?? (brand !== null ? {
    querySelector(selector) {
      if (selector === 'svg[width="182"]' || String(selector).includes('logoRow') || selector === '[data-brand-row]') return brand
      return null
    },
  } : null)
  return {
    querySelector(selector) {
      if (selector === '[data-mobile-drawer-brand]') return brand
      if (selector === '[data-mobile-session-title]') return title
      if (selector === 'nav[aria-label="导航抽屉"]') return drawerNode
      if (String(selector).includes('button[aria-label')) return newSession
      return null
    },
    querySelectorAll(selector) {
      return selector === 'nav button' ? settings : []
    },
  }
}

test('connection badge prefers the drawer brand over the session title', () => {
  const title = { id: 'own' }
  const brand = { id: 'brand', getAttribute: () => 'logoRow', hasAttribute: () => false }
  const fallback = { id: 'official' }
  assert.equal(findConnectionBadgeAnchor(chromeRoot({ title, brand })), brand)
  assert.equal(findConnectionBadgeAnchor(chromeRoot({ title, newSession: fallback })), fallback)
  assert.equal(findConnectionBadgeAnchor(chromeRoot()), null)
})

test('settings trigger matches the official span label and stays silent when missing', () => {
  const settings = spanButton('设置')
  assert.equal(findSettingsTrigger(chromeRoot({ settings: [settings] })), settings)
  assert.equal(findSettingsTrigger(chromeRoot({ settings: [spanButton('Usage')] })), undefined)
  assert.equal(findSettingsTrigger(chromeRoot()), undefined)
})

test('chrome health reports a visible diagnostic when required anchors are missing', () => {
  const healthy = inspectChromeAnchors(chromeRoot({
    brand: { id: 'brand' },
    settings: [spanButton('Settings')],
  }))
  assert.equal(healthy.ok, true)
  assert.deepEqual(healthy.missing, [])
  assert.equal(healthy.message, '')

  const broken = inspectChromeAnchors(chromeRoot())
  assert.equal(broken.ok, false)
  assert.deepEqual(broken.missing, ['connection-badge', 'settings-trigger'])
  assert.equal(broken.message, CHROME_HEALTH_MESSAGE)
})

test('connection badge sits in the brand row before the panel toggle', () => {
  const row = { id: 'row' }
  const toggle = { id: 'toggle', parentElement: row }
  const icon = { parentElement: toggle }
  row.querySelector = (selector) => selector === 'svg[width="16"]' ? icon : null
  assert.equal(queryDrawerToggleSlot(row), toggle)
  assert.equal(queryDrawerToggleSlot({ querySelector: () => null }), null)
})

test('new-session and composer labels share the layout chrome-anchor contract', () => {
  assert.equal(isOfficialNewSessionLabel('New session'), true)
  assert.equal(isOfficialNewSessionLabel('新建会话'), true)
  assert.equal(isOfficialNewSessionLabel('Settings'), false)
  assert.equal(isComposerSendLabel('发送'), true)
  assert.equal(isComposerSendLabel('send message'), true)
  assert.equal(isComposerSendLabel('stop'), false)
})
