/** Stamp the mobile frame when official Agent Team dialog is open.
 * WebView 101 has no :has(), so popover stacking cannot key off the dialog. */

import { markMobileFrameFlag, stampDataset } from './chrome-anchors.ts'

const MEMBERS_HEADING = /members|成员/i

export function isOfficialTeamDialog(element: Element): boolean {
  return element.getAttribute('role') === 'dialog'
    && element.closest('[data-team-action]') !== null
}

/** Mark the Members list so CSS can stack it without a hashed roster class. */
export function stampOfficialTeamRoster(dialog: HTMLElement): void {
  for (const heading of dialog.querySelectorAll('h3')) {
    if (!MEMBERS_HEADING.test(heading.textContent ?? '')) continue
    const roster = heading.nextElementSibling
    if (roster instanceof HTMLElement) stampDataset(roster, 'mobileTeamRoster')
  }
}

/** Close official Agent Team through its trigger, like the model picker.
 * CSS-hiding the dialog while the drawer is open would restore it on close. */
export function dismissOfficialTeamDialog(document: Document = globalThis.document): void {
  for (const trigger of document.querySelectorAll<HTMLButtonElement>('[data-team-action] > button[aria-expanded="true"]')) {
    trigger.click()
  }
}

/** Observe official Agent Team popovers and mark the mobile frame while one is open. */
export function installTeamPanelPresenter(document: Document = globalThis.document): () => void {
  const view = document.defaultView ?? globalThis.window
  let frame = 0
  const scan = (): void => {
    let open = false
    for (const element of document.querySelectorAll<HTMLElement>('[data-team-action] [role="dialog"]')) {
      if (!isOfficialTeamDialog(element)) continue
      stampOfficialTeamRoster(element)
      open = true
    }
    markMobileFrameFlag(document, 'teamOpen', open)
  }
  const runFrame = (): void => { frame = 0; scan() }
  const schedule = (): void => { if (frame === 0) frame = view.requestAnimationFrame(runFrame) }
  const observer = new MutationObserver(schedule)
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['role'] })
  scan()
  return () => {
    observer.disconnect()
    if (frame !== 0) view.cancelAnimationFrame(frame)
    markMobileFrameFlag(document, 'teamOpen', false)
  }
}
