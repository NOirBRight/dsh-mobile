/**
 * Compact the Host's interactive statistics pills without replacing their
 * buttons, icons, accessible names or dialog handlers.
 * Older plain-text statistics are left to their official owner.
 */
export function compactStatsPillText(text: string, tight = false): string {
  let copy = text
    .replace(/([\d,]+)\s*turns?/gi, '$1T')
    .replace(/([\d,]+)\s*steps?/gi, '$1S')
    .replace(/Cache hit\s*/gi, 'Cache ')
    .replace(/缓存命中\s*/g, '缓存')
    .replace(/\s*tok\b(?!\/s)/gi, '')
    .replace(/\s*·\s*/g, ' · ')
    .trim()
  if (tight) {
    copy = copy.replace(/Cache\s*/g, 'C').replace(/缓存\s*/g, 'C')
      .replace(/\s*tok\/s/g, 't/s').replace(/\s*·\s*/g, '·')
      .replace(/([\d,]+)(?=[TS轮步])/g, value => {
        const count = Number(value.replaceAll(',', ''))
        return count >= 1000 ? Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 0 }).format(count) : value
      })
      .replace(/([\d.]+)([KMB])\b/gi, (_value, amount: string, unit: string) => {
        const factor = { K: 1e3, M: 1e6, B: 1e9 }[unit.toUpperCase()]!
        return Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 0 }).format(Number(amount) * factor)
      })
  }
  return copy
}

/** Observe only the public composer dock and stamp its interactive pills. */
export function installStatsLinePresenter(document: Document = globalThis.document): () => void {
  const rows = new Map<HTMLElement, { font: string; marker: string | undefined }>()
  const labels = new Map<HTMLElement, string | undefined>()
  const docks = new Map<HTMLElement, string | undefined>()
  const view = document.defaultView!
  let frame = 0
  let disposed = false
  const schedule = (): void => {
    if (!disposed && frame === 0) frame = view.requestAnimationFrame(() => { frame = 0; scan() })
  }
  const resize = new ResizeObserver(schedule)
  const restoreRow = (row: HTMLElement): void => {
    const original = rows.get(row)!
    if (original.marker === undefined) delete row.dataset.mobileStatsPills
    else row.dataset.mobileStatsPills = original.marker
    if (original.font === '') row.style.removeProperty('--mobile-stats-font')
    else row.style.setProperty('--mobile-stats-font', original.font)
    resize.unobserve(row)
    rows.delete(row)
  }
  const scan = (): void => {
    for (const row of document.querySelectorAll<HTMLElement>('[data-composer-stats], [data-slot="conversation.composer.dock"] > *')) {
      if (!row.querySelector(':scope > span > button[aria-haspopup="dialog"]') ||
          !/tok|轮|turns?|步|steps?/i.test(row.textContent ?? '')) continue
      if (!rows.has(row)) {
        rows.set(row, { font: row.style.getPropertyValue('--mobile-stats-font'), marker: row.dataset.mobileStatsPills })
        resize.observe(row)
      }
      row.dataset.mobileStatsPills = ''
      const slot = row.parentElement
      const dock = slot?.parentElement
      if (slot?.dataset.slot === 'conversation.composer.dock' && dock &&
          [...dock.children].some(child => child.matches('span') && child.querySelector(':scope > button[aria-haspopup="dialog"]'))) {
        if (!docks.has(dock)) docks.set(dock, dock.dataset.mobileStatsDock)
        dock.dataset.mobileStatsDock = ''
      }
      if (row.clientWidth === 0) continue
      const rowLabels = [...row.querySelectorAll<HTMLElement>(':scope > span > button > span, :scope > span > span > span')]
      for (const label of rowLabels) {
        if (!labels.has(label)) labels.set(label, label.dataset.mobileStatsLabel)
      }
      let fitted = false
      for (const tight of [false, true]) {
        for (const label of rowLabels) label.dataset.mobileStatsLabel = compactStatsPillText(label.textContent ?? '', tight)
        for (const size of [13, 12.5, 12]) {
          row.style.setProperty('--mobile-stats-font', `${size}px`)
          const bounds = row.getBoundingClientRect()
          fitted = [...row.children].every(child => {
            const rect = child.getBoundingClientRect()
            return rect.left >= bounds.left - 0.5 && rect.right <= bounds.right + 0.5
          })
          if (fitted) break
        }
        if (fitted) break
      }
    }
    for (const row of rows.keys()) {
      if (!row.isConnected || !/tok|轮|turns?|步|steps?/i.test(row.textContent ?? '')) restoreRow(row)
    }
    for (const [label, original] of labels) if (!label.isConnected) {
      if (original === undefined) delete label.dataset.mobileStatsLabel
      else label.dataset.mobileStatsLabel = original
      labels.delete(label)
    }
    for (const [dock, original] of docks) if (!dock.isConnected || !dock.querySelector('[data-mobile-stats-pills]')) {
      if (original === undefined) delete dock.dataset.mobileStatsDock
      else dock.dataset.mobileStatsDock = original
      docks.delete(dock)
    }
  }
  const observer = new MutationObserver(schedule)
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true })
  scan()
  // Web fonts can change label widths without changing the constrained row.
  void document.fonts?.ready.then(schedule)
  return () => {
    disposed = true
    observer.disconnect()
    resize.disconnect()
    if (frame !== 0) view.cancelAnimationFrame(frame)
    for (const row of rows.keys()) restoreRow(row)
    for (const [label, original] of labels) {
      if (original === undefined) delete label.dataset.mobileStatsLabel
      else label.dataset.mobileStatsLabel = original
    }
    for (const [dock, original] of docks) {
      if (original === undefined) delete dock.dataset.mobileStatsDock
      else dock.dataset.mobileStatsDock = original
    }
    labels.clear()
    docks.clear()
  }
}
