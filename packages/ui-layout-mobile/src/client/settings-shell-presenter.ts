/** Stamp official settings chrome so WebView 101 CSS can recompose it without :has(). */

import { markMobileFrameFlag, stampDataset } from './chrome-anchors.ts'

export function directChildByTag(parent: Element, tag: string): HTMLElement | undefined {
  const want = tag.toUpperCase()
  for (const child of parent.children) {
    if (child.tagName === want) return child as HTMLElement
  }
  return undefined
}

export function isOfficialSettingsDialog(element: Element): boolean {
  return element.getAttribute('role') === 'dialog'
    && element.getAttribute('aria-modal') === 'true'
    && directChildByTag(element, 'NAV') !== undefined
}

function isThemeRow(element: Element): boolean {
  if (element.children.length < 2) return false
  for (const child of element.children) {
    if (child.tagName !== 'BUTTON' || !child.hasAttribute('aria-pressed')) return false
  }
  return true
}

/** Walk one official settings dialog and mark overlay, panel, nav, and inner rows. */
export function markSettingsShell(dialog: HTMLElement): void {
  const nav = directChildByTag(dialog, 'NAV')
  if (nav === undefined) return
  stampDataset(dialog, 'settingsPanel')
  const overlay = dialog.parentElement
  if (overlay instanceof HTMLElement) stampDataset(overlay, 'settingsOverlay')
  stampDataset(nav, 'settingsNav')
  const title = nav.children[0]
  if (title instanceof HTMLElement) stampDataset(title, 'settingsTitle')
  const list = nav.children[nav.children.length - 1]
  if (list instanceof HTMLElement && list !== title) stampDataset(list, 'settingsNavList')
  const content = dialog.children[1]
  if (!(content instanceof HTMLElement)) return
  stampDataset(content, 'settingsContent')
  const header = content.children[0]
  if (header instanceof HTMLElement) stampDataset(header, 'settingsHeader')
  const options = content.lastElementChild
  if (!(options instanceof HTMLElement)) return
  stampDataset(options, 'settingsOptions')
  for (const row of options.querySelectorAll('div')) {
    if (isThemeRow(row)) stampDataset(row, 'settingsThemeRow')
    if (row.querySelector(':scope > span > button') !== null) {
      const titleNode = row.querySelector(':scope > div > div')
      if (titleNode instanceof HTMLElement) stampDataset(titleNode, 'settingsEnterTitle')
    }
    const kids = [...row.children]
    if (kids.some(child => child.tagName === 'A') && kids.some(child => child.tagName === 'BUTTON')) {
      stampDataset(row, 'settingsMarketMeta')
    }
    if (kids[0]?.tagName === 'H2' && kids[1]?.tagName === 'A') stampDataset(row, 'settingsMarketTitle')
    if (kids.filter(child => child.tagName === 'BUTTON').length >= 5) stampDataset(row, 'settingsMarketTabs')
  }
}

/** Observe the document and stamp every live official settings dialog. */
export function installSettingsShellPresenter(document: Document = globalThis.document): () => void {
  const view = document.defaultView ?? globalThis.window
  let frame = 0
  const scan = (): void => {
    let open = false
    for (const element of document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')) {
      if (!isOfficialSettingsDialog(element)) continue
      markSettingsShell(element)
      open = true
    }
    markMobileFrameFlag(document, 'settingsOpen', open)
  }
  const runFrame = (): void => { frame = 0; scan() }
  const schedule = (): void => { if (frame === 0) frame = view.requestAnimationFrame(runFrame) }
  const observer = new MutationObserver(schedule)
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['role', 'aria-modal'] })
  scan()
  return () => {
    observer.disconnect()
    if (frame !== 0) view.cancelAnimationFrame(frame)
    markMobileFrameFlag(document, 'settingsOpen', false)
  }
}
