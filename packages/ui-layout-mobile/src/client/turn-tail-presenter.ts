/** Mobile presenter for the official assistant turn clock/metrics tail. */

const TURN_TIME_SELECTOR = [
  '[data-turn-tail] [class*="timeEnd"]',
  '[data-time-hover-root] [class*="timeEnd"]',
  '[data-turn-tail] [class*="timeStart"]',
  '[data-time-hover-root] [class*="timeStart"]',
].join(', ')

function normalizedDuration(part: string): string | null {
  const compact = part.trim().replace(/\s+/g, '')
  const latin = /((?:\d+(?:\.\d+)?(?:ms|h|m|s)){1,3})$/i.exec(compact)?.[1]
  if (latin !== undefined) return latin
  const zh = /(?:(\d+(?:\.\d+)?)小时)?(?:(\d+(?:\.\d+)?)分钟)?(?:(\d+(?:\.\d+)?)秒)?$/.exec(compact)
  if (zh !== null && (zh[1] !== undefined || zh[2] !== undefined || zh[3] !== undefined)) {
    return [zh[1] === undefined ? '' : zh[1] + 'h', zh[2] === undefined ? '' : zh[2] + 'm', zh[3] === undefined ? '' : zh[3] + 's'].join('')
  }
  return null
}

export function compactTurnTailText(text: string): string {
  const parts = text.split('·').map(part => part.trim()).filter(Boolean)
  const clock = parts[0]
  if (clock === undefined) return ''
  let duration: string | null = null
  let throughput: string | null = null
  for (const part of parts.slice(1)) {
    if (/TTFT/i.test(part)) continue
    const rate = /(\d+(?:\.\d+)?)\s*tok\/s/i.exec(part)
    if (rate?.[1] !== undefined) {
      throughput = rate[1] + ' tok/s'
      continue
    }
    duration ??= normalizedDuration(part)
  }
  return [clock, duration, throughput].filter((part): part is string => part !== null).join(' · ')
}

interface OriginalTurnTail {
  readonly marker: string | undefined
  readonly ariaLabel: string | null
}

/** Keep React-owned text intact; expose the compact visual/accessibility copy through attributes. */
export function installTurnTailPresenter(document: Document = globalThis.document): () => void {
  const originals = new Map<HTMLElement, OriginalTurnTail>()
  let frame = 0
  const view = document.defaultView ?? globalThis.window

  const scan = (): void => {
    for (const element of document.querySelectorAll<HTMLElement>(TURN_TIME_SELECTOR)) {
      const summary = compactTurnTailText(element.textContent ?? '')
      if (summary === '') continue
      if (!originals.has(element)) originals.set(element, {
        marker: element.dataset.mobileTurnSummary,
        ariaLabel: element.getAttribute('aria-label'),
      })
      element.dataset.mobileTurnSummary = summary
      element.setAttribute('aria-label', summary)
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
      if (original.marker === undefined) delete element.dataset.mobileTurnSummary
      else element.dataset.mobileTurnSummary = original.marker
      if (original.ariaLabel === null) element.removeAttribute('aria-label')
      else element.setAttribute('aria-label', original.ariaLabel)
    }
    originals.clear()
  }
}
