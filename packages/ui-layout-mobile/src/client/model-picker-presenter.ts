/** Mobile-only presentation for searchable model picker option details. */

export function compactModelOptionDetail(text: string): string {
  const trimmed = text.trim()
  const parts = trimmed.split('·').map(part => part.trim()).filter(Boolean)
  if (parts.length < 2) return trimmed
  const capacity = parts.at(-1)
  return capacity !== undefined && /^\d+(?:\.\d+)?\s*[KMG](?:\s*(?:tokens?|上下文))?$/i.test(capacity)
    ? capacity.replace(/\s+/g, '')
    : trimmed
}

/** Closed trigger keeps the product name. Only · effort/fast/context/thinking stay in the menu. */
export function compactModelTriggerLabel(text: string): string {
  const trimmed = text.trim()
  const cut = trimmed.indexOf(' · ')
  return (cut === -1 ? trimmed : trimmed.slice(0, cut)).trim()
}

function isModelTrigger(button: HTMLElement): boolean {
  const label = button.getAttribute('aria-label') ?? ''
  return label.startsWith('Select model') || label.startsWith('选择模型')
}

interface OriginalModelDetail {
  readonly marker: string | undefined
  readonly ariaLabel: string | null
}

export function installModelPickerPresenter(document: Document = globalThis.document): () => void {
  const originals = new Map<HTMLElement, OriginalModelDetail>()
  const triggerOriginals = new Map<HTMLElement, string | undefined>()
  let frame = 0
  const view = document.defaultView ?? globalThis.window

  const scan = (): void => {
    for (const element of document.querySelectorAll<HTMLElement>('[role="listbox"] [class*="detail"]')) {
      const originalText = element.textContent ?? ''
      const compact = compactModelOptionDetail(originalText)
      if (compact === originalText.trim()) continue
      if (!originals.has(element)) originals.set(element, {
        marker: element.dataset.mobileModelDetail,
        ariaLabel: element.getAttribute('aria-label'),
      })
      element.dataset.mobileModelDetail = compact
      element.setAttribute('aria-label', compact)
    }
    const liveTriggers = new Set<HTMLElement>()
    for (const button of document.querySelectorAll<HTMLElement>('[data-composer-card] button[aria-haspopup="menu"]')) {
      if (!isModelTrigger(button)) continue
      const label = button.querySelector<HTMLElement>(':scope > span:first-of-type')
      if (label === null) continue
      const compact = compactModelTriggerLabel(label.textContent ?? '')
      if (compact === (label.textContent ?? '').trim()) continue
      liveTriggers.add(label)
      if (!triggerOriginals.has(label)) triggerOriginals.set(label, label.dataset.mobileModelTrigger)
      label.dataset.mobileModelTrigger = compact
    }
    for (const [element, original] of triggerOriginals) {
      if (liveTriggers.has(element)) continue
      if (original === undefined) delete element.dataset.mobileModelTrigger
      else element.dataset.mobileModelTrigger = original
      triggerOriginals.delete(element)
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
      if (original.marker === undefined) delete element.dataset.mobileModelDetail
      else element.dataset.mobileModelDetail = original.marker
      if (original.ariaLabel === null) element.removeAttribute('aria-label')
      else element.setAttribute('aria-label', original.ariaLabel)
    }
    originals.clear()
    for (const [element, original] of triggerOriginals) {
      if (original === undefined) delete element.dataset.mobileModelTrigger
      else element.dataset.mobileModelTrigger = original
    }
    triggerOriginals.clear()
  }
}
