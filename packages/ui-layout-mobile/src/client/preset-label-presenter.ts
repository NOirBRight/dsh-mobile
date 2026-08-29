/** Mobile-only visible copy for known preset labels that can inherit file metadata. */

/** Return the language-neutral PTC label without rewriting arbitrary preset names. */
export function compactPresetLabel(text: string): string | null {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return /^PTC(?: mode| 模式)?$/iu.test(normalized) ? 'PTC' : null
}

/** Replace only the exact visible PTC text node while preserving its accessible owner. */
export function installPresetLabelPresenter(document: Document = globalThis.document): () => void {
  const originals = new Map<Text, string>()
  const view = document.defaultView ?? globalThis.window
  let frame = 0

  const scan = (): void => {
    const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node !== null) {
      const text = node as Text
      const compact = compactPresetLabel(text.data)
      if (compact !== null) {
        if (!originals.has(text)) originals.set(text, text.data)
        if (text.data !== compact) text.data = compact
      } else if (originals.has(text)) {
        originals.delete(text)
      }
      node = walker.nextNode()
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
    for (const [text, original] of originals) {
      if (text.isConnected && text.data === 'PTC') text.data = original
    }
    originals.clear()
  }
}
