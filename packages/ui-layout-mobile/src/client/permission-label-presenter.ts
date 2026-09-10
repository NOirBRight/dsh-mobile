/** Mobile-only permission trigger: icon button, generic glyph when the Host has none. */

export function isPermissionTriggerLabel(ariaLabel: string): boolean {
  return ariaLabel.startsWith('Access mode') || ariaLabel.startsWith('访问模式')
}

export function permissionTriggerNeedsGenericIcon(button: HTMLElement): boolean {
  return button.querySelector(':scope > span:first-of-type svg, :scope > svg:first-child') === null
}

interface OriginalPermissionMark {
  readonly trigger: string | undefined
  readonly generic: string | undefined
}

/** Mark official permission triggers so CSS can collapse them to a 28px icon. */
export function installPermissionLabelPresenter(document: Document = globalThis.document): () => void {
  const originals = new Map<HTMLElement, OriginalPermissionMark>()
  const view = document.defaultView ?? globalThis.window
  let frame = 0

  const scan = (): void => {
    const live = new Set<HTMLElement>()
    // Official PermissionSelect is a native <button aria-label="Access mode…"> with
    // no aria-haspopup; Menu wraps it in a span and does not clone that attr.
    for (const element of document.querySelectorAll<HTMLElement>('[data-composer-card] button[aria-label]')) {
      if (!isPermissionTriggerLabel(element.getAttribute('aria-label') ?? '')) continue
      live.add(element)
      if (!originals.has(element)) originals.set(element, {
        trigger: element.dataset.mobilePermissionTrigger,
        generic: element.dataset.mobilePermissionGeneric,
      })
      element.dataset.mobilePermissionTrigger = ''
      if (permissionTriggerNeedsGenericIcon(element)) element.dataset.mobilePermissionGeneric = ''
      else delete element.dataset.mobilePermissionGeneric
    }
    for (const [element, original] of originals) {
      if (live.has(element)) continue
      restorePermissionMark(element, original)
      originals.delete(element)
    }
  }
  const runFrame = (): void => { frame = 0; scan() }
  const schedule = (): void => { if (frame === 0) frame = view.requestAnimationFrame(runFrame) }
  const observer = new MutationObserver(schedule)
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-label'] })
  scan()

  return () => {
    observer.disconnect()
    if (frame !== 0) view.cancelAnimationFrame(frame)
    for (const [element, original] of originals) restorePermissionMark(element, original)
    originals.clear()
  }
}

function restorePermissionMark(element: HTMLElement, original: OriginalPermissionMark): void {
  if (original.trigger === undefined) delete element.dataset.mobilePermissionTrigger
  else element.dataset.mobilePermissionTrigger = original.trigger
  if (original.generic === undefined) delete element.dataset.mobilePermissionGeneric
  else element.dataset.mobilePermissionGeneric = original.generic
}
