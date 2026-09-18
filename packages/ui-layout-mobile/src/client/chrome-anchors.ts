/** Named Host-chrome label matchers. Official aria/copy is the fallback contract. */

export const NEW_SESSION_ARIA = /(?:new|create)\s+session/i
export const NEW_SESSION_ARIA_ZH = /(?:新建|创建)会话/
export const COMPOSER_STOP_LABEL = /^(?:停止生成|停止|stop generating|stop)$/i
export const COMPOSER_SEND_LABEL = /^(?:发送消息|发送|send message|send)$/i
/** Owned by MobileFrame, not Host copy. Stamp selectors key this label. */
export const DRAWER_ARIA_LABEL = '导航抽屉'
const DRAWER = `nav[aria-label="${DRAWER_ARIA_LABEL}"]`

export function isOfficialNewSessionLabel(label: string): boolean {
  return NEW_SESSION_ARIA.test(label) || NEW_SESSION_ARIA_ZH.test(label)
}

export function isComposerStopLabel(label: string | null): boolean {
  return label !== null && COMPOSER_STOP_LABEL.test(label.trim())
}

export function isComposerSendLabel(label: string | null): boolean {
  return label !== null && COMPOSER_SEND_LABEL.test(label.trim())
}

export function stampDataset(element: HTMLElement, datasetKey: string): void {
  if (element.dataset[datasetKey] === undefined) element.dataset[datasetKey] = ''
}

/** Set or clear a boolean dataset flag on the mobile frame root. */
export function markMobileFrameFlag(document: Document, datasetKey: string, open: boolean): void {
  const frame = document.querySelector('[data-mobile-topbar]')?.parentElement
  if (!(frame instanceof HTMLElement)) return
  if (open) stampDataset(frame, datasetKey)
  else delete frame.dataset[datasetKey]
}

/** Stamp the official New Session control so CSS can size it without hashed classes. */
export function stampOfficialNewSession(root: ParentNode = globalThis.document): void {
  for (const button of root.querySelectorAll('button[aria-label]')) {
    if (!(button instanceof HTMLButtonElement)) continue
    if (!isOfficialNewSessionLabel(button.getAttribute('aria-label') ?? '')) continue
    stampDataset(button, 'mobileNewSession')
    for (const child of button.children) {
      if (child.tagName !== 'SPAN') continue
      stampDataset(child as HTMLElement, 'mobileNewSessionLabel')
      break
    }
  }
}

/** Stamp official sidebar panel entries (Plugins, etc.) for phone hit targets. */
export function stampOfficialPanelRows(root: ParentNode = globalThis.document): void {
  const drawer = root.querySelector(DRAWER)
  if (drawer === null) return
  for (const nav of drawer.querySelectorAll('nav')) {
    for (const button of nav.querySelectorAll('button[aria-label]')) {
      if (!(button instanceof HTMLButtonElement)) continue
      if (isOfficialNewSessionLabel(button.getAttribute('aria-label') ?? '')) continue
      if (button.getAttribute('aria-haspopup') === 'dialog') continue
      stampDataset(button, 'mobilePanelRow')
    }
  }
}

/** Stamp the Settings footer row and its connection-indicator label. */
export function stampOfficialSettingsRow(root: ParentNode = globalThis.document): void {
  const drawer = root.querySelector(DRAWER)
  if (drawer === null) return
  for (const trigger of drawer.querySelectorAll('button[aria-haspopup="dialog"]')) {
    if (!(trigger instanceof HTMLButtonElement)) continue
    if (trigger.closest('[data-settings-panel]') !== null) continue
    const row = trigger.parentElement
    if (!(row instanceof HTMLElement)) continue
    stampDataset(row, 'mobileSettingsRow')
    for (const child of row.children) {
      if (!(child instanceof HTMLElement)) continue
      if (child.getAttribute('role') !== 'status' && !child.hasAttribute('data-phase')) continue
      for (const span of child.querySelectorAll('span')) {
        if (span.getAttribute('aria-hidden') === 'true') continue
        stampDataset(span, 'mobileConnectionLabel')
        break
      }
    }
  }
}

/** Stamp the conversation preset chip so CSS can ellipsize it without hashed classes. */
export function stampOfficialModeLabel(root: ParentNode = globalThis.document): void {
  for (const team of root.querySelectorAll('[data-team-action]')) {
    const actions = team.parentElement
    if (!(actions instanceof HTMLElement)) continue
    for (const span of actions.querySelectorAll('span[title]')) {
      if (!(span instanceof HTMLElement)) continue
      if (span.closest('button') !== null) continue
      stampDataset(span, 'modeLabel')
    }
  }
}

export function stampOfficialDrawerChrome(root: ParentNode = globalThis.document): void {
  stampOfficialNewSession(root)
  stampOfficialPanelRows(root)
  stampOfficialSettingsRow(root)
  stampOfficialModeLabel(root)
}

/** Observe official chrome and stamp published data attrs when Host modules mount. */
export function installDrawerChromePresenter(document: Document = globalThis.document): () => void {
  const view = document.defaultView ?? globalThis.window
  let frame = 0
  const scan = (): void => { stampOfficialDrawerChrome(document) }
  const runFrame = (): void => { frame = 0; scan() }
  const schedule = (): void => { if (frame === 0) frame = view.requestAnimationFrame(runFrame) }
  const observer = new MutationObserver(schedule)
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['aria-label', 'aria-haspopup', 'data-phase', 'title', 'role'],
  })
  scan()
  return () => {
    observer.disconnect()
    if (frame !== 0) view.cancelAnimationFrame(frame)
  }
}
