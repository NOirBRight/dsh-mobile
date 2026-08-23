/** Named resolvers for shell chrome. Own DOM first; official aria/copy is fallback only. */

export const OWN_SESSION_TITLE = '[data-mobile-session-title]'
export const OWN_DRAWER_BRAND = '[data-mobile-drawer-brand]'
export const OWN_TOPBAR = '[data-mobile-topbar]'
export const OWN_COMPOSER_CARD = '[data-composer-card]'
export const OWN_PROFILE_ACTION = '[data-mobile-profile-action]'

export const OFFICIAL_DRAWER = 'nav[aria-label="导航抽屉"]'
export const OFFICIAL_NEW_SESSION =
  'nav[aria-label="导航抽屉"] button[aria-label="New session"], nav[aria-label="导航抽屉"] button[aria-label="新建会话"], nav[aria-label="导航抽屉"] button[aria-label="新会话"]'

export const SETTINGS_LABELS = ['设置', 'Settings'] as const
export {
  NEW_SESSION_ARIA,
  NEW_SESSION_ARIA_ZH,
  isOfficialNewSessionLabel,
  isComposerSendLabel,
  isComposerStopLabel,
} from '../../../packages/ui-layout-mobile/src/client/chrome-anchors.ts'

export const CHROME_HEALTH_MESSAGE = '部分界面增强不可用（Host UI 有变更）'

export interface ChromeAnchorHealth {
  ok: boolean
  missing: string[]
  message: string
}

/** Prefer the drawer brand row; fall back to the official New session control. */
export function findConnectionBadgeAnchor(root: ParentNode = document): Element | null {
  const branded = root.querySelector(OWN_DRAWER_BRAND)
  if (branded !== null && isDrawerBrandRow(branded)) return branded
  const drawer = root.querySelector(OFFICIAL_DRAWER)
  const row = queryDrawerBrandRow(drawer)
  if (row !== null) {
    try { row.setAttribute('data-mobile-drawer-brand', '') } catch { /* mock roots */ }
    return row
  }
  if (branded !== null) return branded
  return root.querySelector(OFFICIAL_NEW_SESSION)
}

function isDrawerBrandRow(el: Element): boolean {
  const cls = typeof el.getAttribute === 'function' ? el.getAttribute('class') ?? '' : ''
  if (cls.includes('logoRow')) return true
  return typeof el.hasAttribute === 'function' && el.hasAttribute('data-brand-row')
}

function queryDrawerBrandRow(drawer: Element | null): Element | null {
  if (drawer === null || typeof drawer.querySelector !== 'function') return null
  return drawer.querySelector('[class*="logoRow"]')
    ?? drawer.querySelector('[data-brand-row]')
}

/** Collapse control in the brand row, or null when the anchor is a fallback. */
export function queryDrawerToggleSlot(row: Element): Element | null {
  if (typeof row.querySelector !== 'function') return null
  const icon = row.querySelector('svg[width="16"]')
    ?? row.querySelector('[class*="panelIcon"]')
  if (icon === null) return null
  let slot: Element = icon
  while (slot.parentElement !== null && slot.parentElement !== row) slot = slot.parentElement
  return slot.parentElement === row ? slot : null
}

/** Official Settings trigger in the navigation drawer, identified by visible label. */
export function findSettingsTrigger(root: ParentNode = document): HTMLButtonElement | undefined {
  return findSettingsNavButton(new Set(SETTINGS_LABELS), root)
}

/** Settings-nav button whose span matches one of the given labels. Missing is silent. */
export function findSettingsNavButton(
  labels: ReadonlySet<string>,
  root: ParentNode = document,
): HTMLButtonElement | undefined {
  return [...root.querySelectorAll<HTMLButtonElement>('nav button')].find(button =>
    [...button.querySelectorAll('span')].some(span => labels.has(span.textContent?.trim() ?? '')),
  )
}

/** Probe required chrome after boot. Composer is optional until a session paints. */
export function inspectChromeAnchors(root: ParentNode = document): ChromeAnchorHealth {
  const missing: string[] = []
  if (findConnectionBadgeAnchor(root) === null) missing.push('connection-badge')
  if (findSettingsTrigger(root) === undefined) missing.push('settings-trigger')
  const ok = missing.length === 0
  return {
    ok,
    missing,
    message: ok ? '' : CHROME_HEALTH_MESSAGE,
  }
}
