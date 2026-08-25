/** Mobile-only visible labels for permission chips that must fit the composer row. */

export function compactPermissionLabel(text: string): string | null {
  return text.replace(/\s+/g, ' ').trim().toLocaleLowerCase() === 'workspace write' ? 'Workspace' : null
}

/** Preserve React-owned text and expose the compact visual copy through a data marker. */
export function installPermissionLabelPresenter(document: Document = globalThis.document): () => void {
  const originals = new Map<HTMLElement, string | undefined>()
  const view = document.defaultView ?? globalThis.window
  let frame = 0

  const scan = (): void => {
    const elements = document.querySelectorAll<HTMLElement>(
      '[data-composer-card] button[aria-haspopup="menu"] span, [data-mobile-permission-label]',
    )
    for (const element of elements) {
      const compact = compactPermissionLabel(element.textContent ?? '')
      if (compact === null) {
        if (originals.has(element)) {
          const original = originals.get(element)
          if (original === undefined) delete element.dataset.mobilePermissionLabel
          else element.dataset.mobilePermissionLabel = original
          originals.delete(element)
        }
        continue
      }
      if (!originals.has(element)) originals.set(element, element.dataset.mobilePermissionLabel)
      element.dataset.mobilePermissionLabel = compact
    }
  }
  const runFrame = (): void => { frame = 0; scan() }
  const schedule = (): void => { if (frame === 0) frame = view.requestAnimationFrame(runFrame) }
  const observer = new MutationObserver(schedule)
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true })
  scan()

  return () => {
    observer.disconnect()
    if (frame !== 0) view.cancelAnimationFrame(frame)
    for (const [element, original] of originals) {
      if (original === undefined) delete element.dataset.mobilePermissionLabel
      else element.dataset.mobilePermissionLabel = original
    }
    originals.clear()
  }
}
