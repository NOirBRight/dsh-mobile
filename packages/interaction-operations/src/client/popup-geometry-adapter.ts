/** Mobile-only popup sizing and Anchor-edge placement. */
export type MobilePopupKind = 'simple' | 'rich' | 'listbox'

export function popupWidth(kind: MobilePopupKind, naturalWidth: number, anchorWidth: number, viewportWidth: number, gutter = 12): number {
  const available = Math.max(0, viewportWidth - gutter * 2)
  if (kind === 'simple') return Math.min(available, Math.max(144, Math.min(280, naturalWidth, Math.max(naturalWidth, anchorWidth))))
  if (kind === 'rich') return Math.min(available, Math.max(220, Math.min(320, Math.max(naturalWidth, anchorWidth))))
  return Math.min(available, Math.max(220, Math.max(anchorWidth, Math.min(naturalWidth, available))))
}

export function popupPlacement(input: {
  viewportLeft: number
  viewportWidth: number
  gutter: number
  popupWidth: number
  anchorLeft: number
  anchorRight: number
}): { left: number; align: 'start' | 'end' } {
  const viewportRight = input.viewportLeft + input.viewportWidth
  const anchorCenter = (input.anchorLeft + input.anchorRight) / 2
  const align = anchorCenter <= input.viewportLeft + input.viewportWidth / 2 ? 'start' : 'end'
  const desired = align === 'start' ? input.anchorLeft : input.anchorRight - input.popupWidth
  const left = Math.min(
    Math.max(desired, input.viewportLeft + input.gutter),
    viewportRight - input.gutter - input.popupWidth,
  )
  return { left: Math.round(left), align }
}

export function popupHeightLimit(kind: MobilePopupKind, viewportHeight: number, gutter = 12): number {
  const available = Math.max(0, viewportHeight - gutter * 2)
  const cap = kind === 'simple' ? 480 : Math.min(360, Math.floor(viewportHeight * 0.56))
  return Math.min(available, cap)
}

export function popupVerticalPlacement(input: {
  viewportTop: number
  viewportHeight: number
  gutter: number
  popupHeight: number
  anchorTop: number
  anchorBottom: number
  opensAbove: boolean
}): { top: number; maxHeight: number } {
  const maxHeight = Math.max(0, input.viewportHeight - input.gutter * 2)
  const height = Math.min(input.popupHeight, maxHeight)
  const desired = input.opensAbove ? input.anchorTop - height - 4 : input.anchorBottom + 4
  const top = Math.min(
    Math.max(desired, input.viewportTop + input.gutter),
    input.viewportTop + input.viewportHeight - input.gutter - height,
  )
  return { top: Math.round(top), maxHeight: Math.round(maxHeight) }
}

interface OriginalSurface {
  readonly style: string | null
  readonly marker: string | undefined
}

function rendered(element: HTMLElement): boolean {
  if (element.getClientRects().length === 0) return false
  const style = getComputedStyle(element)
  return style.display !== 'none' && style.visibility !== 'hidden'
}

function authoredPopupWidth(popup: HTMLElement, originalStyle: string | null): number {
  const adaptedStyle = popup.getAttribute('style')
  if (originalStyle === null) popup.removeAttribute('style')
  else popup.setAttribute('style', originalStyle)
  const width = popup.getBoundingClientRect().width
  if (adaptedStyle === null) popup.removeAttribute('style')
  else popup.setAttribute('style', adaptedStyle)
  return width
}

function popupKind(element: HTMLElement): MobilePopupKind {
  if (element.getAttribute('role') === 'listbox') return 'listbox'
  if (element.querySelector('input, textarea, [role="menuitemradio"], [role="menuitemcheckbox"]') !== null) return 'rich'
  const rows = element.querySelectorAll('[role="menuitem"]')
  if (rows.length > 8 || (element.textContent?.trim().length ?? 0) > 96) return 'rich'
  return 'simple'
}

function popupPresentationSurface(popup: HTMLElement): HTMLElement {
  if (popup.getAttribute('role') !== 'listbox') return popup
  const card = popup.parentElement
  return card !== null && card.querySelector('input, textarea') !== null ? card : popup
}

function topDismissiblePopup(document: Document): HTMLElement | null {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>('[role="menu"], [role="listbox"]'))
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const popup = candidates[index]
    if (popup === undefined || !rendered(popup)) continue
    if (popup.hidden || popup.getAttribute('aria-hidden') === 'true' || popup.closest('[aria-hidden="true"]') !== null) continue
    return popup
  }
  return null
}

function dispatchOfficialOutsidePointerDown(target: Element, view: Window): void {
  target.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true, view,
  }))
}

function dispatchOfficialOutsideMouseDown(target: Element, view: Window): void {
  target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view }))
}

function candidateAnchor(
  document: Document, popup: HTMLElement, lastTrigger: HTMLElement | null, remembered: HTMLElement | null = null,
): HTMLElement | null {
  if (popup.id !== '') {
    const controlled = Array.from(document.querySelectorAll<HTMLElement>('[aria-controls]'))
      .find(candidate => candidate.getAttribute('aria-controls')?.split(/\s+/).includes(popup.id) === true)
    if (controlled !== undefined) return controlled
  }
  // Local in-place menus conventionally follow their trigger. Never search an
  // application root for a portaled surface: that picks an unrelated button.
  if (popup.parentElement !== document.body && popup.parentElement !== document.documentElement) {
    for (let sibling = popup.previousElementSibling; sibling !== null; sibling = sibling.previousElementSibling) {
      const trigger = sibling.matches('button, [aria-haspopup]')
        ? sibling as HTMLElement
        : sibling.querySelector<HTMLElement>('button, [aria-haspopup]')
      if (trigger !== null) return trigger
    }
  }
  // A live semantic owner always wins; only reuse history when the popup no
  // longer exposes a current ARIA/local relationship.
  if (remembered?.isConnected === true) return remembered
  if (lastTrigger?.isConnected === true) return lastTrigger
  const active = document.activeElement
  if (active instanceof HTMLElement && active.matches('button, [aria-haspopup]')) return active
  const expanded = Array.from(document.querySelectorAll<HTMLElement>('[aria-expanded="true"]'))
  if (expanded.length === 0) return null
  const rect = popup.getBoundingClientRect()
  return expanded.toSorted((a, b) => {
    const ar = a.getBoundingClientRect()
    const br = b.getBoundingClientRect()
    return Math.abs(ar.left - rect.left) + Math.abs(ar.top - rect.top) - Math.abs(br.left - rect.left) - Math.abs(br.top - rect.top)
  })[0] ?? null
}

/** Install one retractable geometry presenter for Menu/listbox surfaces. */
export function installPopupGeometryAdapter(document: Document = globalThis.document): () => void {
  const originals = new Map<HTMLElement, OriginalSurface>()
  const resolvedAnchors = new WeakMap<HTMLElement, HTMLElement>()
  let lastTrigger: HTMLElement | null = null
  let frame = 0
  let resizeObserver: ResizeObserver | undefined
  const observed = new WeakSet<HTMLElement>()
  const view = document.defaultView ?? globalThis.window

  const rememberTrigger = (event: Event): void => {
    if (!(event.target instanceof Element)) return
    const trigger = event.target.closest<HTMLElement>('button, [aria-haspopup]')
    if (trigger !== null && trigger.closest('[role="menu"], [role="listbox"]') === null) lastTrigger = trigger
  }

  const resolveAnchor = (popup: HTMLElement, requireRendered = false): HTMLElement | null => {
    const remembered = resolvedAnchors.get(popup) ?? null
    const candidate = candidateAnchor(document, popup, lastTrigger, remembered)
    const anchor = candidate !== null && (!requireRendered || rendered(candidate)) ? candidate : null
    if (anchor !== null) resolvedAnchors.set(popup, anchor)
    return anchor
  }

  const outsidePopup = (target: Element): HTMLElement | null => {
    const popup = topDismissiblePopup(document)
    if (popup === null) return null
    const owner = popupPresentationSurface(popup)
    const anchor = resolveAnchor(popup)
    return popup.contains(target) || owner.contains(target) || anchor?.contains(target) === true ? null : popup
  }

  const bridgeTouchOutside = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch' || !(event.target instanceof Element)) return
    if (outsidePopup(event.target) === null) return
    dispatchOfficialOutsideMouseDown(event.target, view)
  }

  const bridgeClickOutside = (event: MouseEvent): void => {
    if (!(event.target instanceof Element) || outsidePopup(event.target) === null) return
    dispatchOfficialOutsidePointerDown(event.target, view)
    dispatchOfficialOutsideMouseDown(event.target, view)
  }

  const dismissPopupForTakeover = (): void => {
    const takeover = document.querySelector<HTMLElement>('[data-question-scroll]')
    const popup = topDismissiblePopup(document)
    if (takeover === null || popup === null || popup.contains(takeover)) return
    dispatchOfficialOutsidePointerDown(takeover, view)
    dispatchOfficialOutsideMouseDown(takeover, view)
  }

  interface PreparedPopup {
    popup: HTMLElement
    anchor: HTMLElement | null
    kind: MobilePopupKind
    width: number
    maxHeight: number
  }

  const prepare = (popup: HTMLElement): PreparedPopup | null => {
    if (!rendered(popup) || popup.parentElement?.closest('[role="menu"]') !== null) return null
    const anchor = resolveAnchor(popup, true)
    let original = originals.get(popup)
    if (original === undefined) {
      original = { style: popup.getAttribute('style'), marker: popup.dataset.dshMobilePopup }
      originals.set(popup, original)
    }
    const viewport = view.visualViewport
    const viewportWidth = viewport?.width ?? view.innerWidth
    const viewportHeight = viewport?.height ?? view.innerHeight
    const kind = popupKind(popup)
    const maxHeight = popupHeightLimit(kind, viewportHeight)
    const authoredWidth = authoredPopupWidth(popup, original.style)

    popup.dataset.dshMobilePopup = kind
    popup.style.setProperty('position', 'fixed', 'important')
    popup.style.setProperty('min-width', '0', 'important')
    popup.style.setProperty('max-width', 'none', 'important')
    popup.style.setProperty('max-height', maxHeight + 'px', 'important')
    popup.style.setProperty('overflow-y', kind === 'rich' ? 'hidden' : 'auto', 'important')
    popup.style.setProperty('width', 'max-content', 'important')
    popup.style.setProperty('transform', 'none', 'important')
    const naturalWidth = kind === 'rich' ? Math.max(authoredWidth, popup.scrollWidth) : popup.scrollWidth
    const width = popupWidth(kind, naturalWidth, anchor?.getBoundingClientRect().width ?? 0, viewportWidth)
    popup.style.setProperty('width', width + 'px', 'important')
    return { popup, anchor, kind, width, maxHeight }
  }

  const place = ({ popup, anchor, width, maxHeight }: PreparedPopup): void => {
    const viewport = view.visualViewport
    const viewportLeft = viewport?.offsetLeft ?? 0
    const viewportTop = viewport?.offsetTop ?? 0
    const viewportWidth = viewport?.width ?? view.innerWidth
    const viewportHeight = viewport?.height ?? view.innerHeight
    const before = popup.getBoundingClientRect()
    const ar = anchor?.getBoundingClientRect() ?? before
    const horizontal = anchor === null
      ? {
          left: Math.round(Math.min(Math.max(before.left, viewportLeft + 12), viewportLeft + viewportWidth - 12 - width)),
          align: (before.left + before.right) / 2 <= viewportLeft + viewportWidth / 2 ? 'start' as const : 'end' as const,
        }
      : popupPlacement({ viewportLeft, viewportWidth, gutter: 12, popupWidth: width, anchorLeft: ar.left, anchorRight: ar.right })
    const measuredHeight = before.height
    const vertical = anchor === null
      ? {
          top: Math.round(Math.min(Math.max(before.top, viewportTop + 12), viewportTop + viewportHeight - 12 - Math.min(measuredHeight, maxHeight))),
          maxHeight,
        }
      : popupVerticalPlacement({
          viewportTop, viewportHeight, gutter: 12, popupHeight: measuredHeight,
          anchorTop: ar.top, anchorBottom: ar.bottom,
          opensAbove: before.bottom <= ar.top + 2 || ar.top > viewportTop + viewportHeight / 2,
        })
    popup.style.setProperty('left', horizontal.left + 'px', 'important')
    popup.style.setProperty('right', 'auto', 'important')
    popup.style.setProperty('top', vertical.top + 'px', 'important')
    popup.style.setProperty('bottom', 'auto', 'important')
    popup.style.setProperty('z-index', '1200', 'important')
    popup.dataset.dshMobileAlign = horizontal.align
  }

  const scan = (): void => {
    const prepared: PreparedPopup[] = []
    const surfaces = new Set(Array.from(document.querySelectorAll<HTMLElement>('[role="menu"], [role="listbox"]'), popupPresentationSurface))
    for (const popup of surfaces) {
      const entry = prepare(popup)
      if (entry !== null) prepared.push(entry)
      if (!observed.has(popup)) {
        observed.add(popup)
        resizeObserver?.observe(popup)
      }
    }
    for (const entry of prepared) place(entry)
  }
  const runFrame = (): void => {
    frame = 0
    scan()
  }
  const schedule = (): void => {
    if (frame === 0) frame = view.requestAnimationFrame(runFrame)
  }

  if (typeof ResizeObserver === 'function') resizeObserver = new ResizeObserver(schedule)
  document.addEventListener('pointerdown', bridgeTouchOutside, true)
  document.addEventListener('pointerdown', rememberTrigger, true)
  document.addEventListener('click', bridgeClickOutside, true)
  document.addEventListener('click', rememberTrigger, true)
  view.addEventListener('resize', schedule)
  view.addEventListener('scroll', schedule, true)
  view.visualViewport?.addEventListener('resize', schedule)
  view.visualViewport?.addEventListener('scroll', schedule)
  const observer = new MutationObserver(() => {
    dismissPopupForTakeover()
    schedule()
  })
  observer.observe(document.documentElement, {
    subtree: true, childList: true, characterData: true, attributes: true,
    attributeFilter: ['aria-expanded', 'hidden', 'class'],
  })
  // Present already-mounted surfaces synchronously, then retain frame-coalesced
  // recomputation for hot conversation and popup mutations.
  scan()
  schedule()

  return () => {
    observer.disconnect()
    resizeObserver?.disconnect()
    if (frame !== 0) view.cancelAnimationFrame(frame)
    document.removeEventListener('pointerdown', bridgeTouchOutside, true)
    document.removeEventListener('pointerdown', rememberTrigger, true)
    document.removeEventListener('click', bridgeClickOutside, true)
    document.removeEventListener('click', rememberTrigger, true)
    view.removeEventListener('resize', schedule)
    view.removeEventListener('scroll', schedule, true)
    view.visualViewport?.removeEventListener('resize', schedule)
    view.visualViewport?.removeEventListener('scroll', schedule)
    for (const [surface, original] of originals) {
      if (original.style === null) surface.removeAttribute('style')
      else surface.setAttribute('style', original.style)
      if (original.marker === undefined) delete surface.dataset.dshMobilePopup
      else surface.dataset.dshMobilePopup = original.marker
      delete surface.dataset.dshMobileAlign
    }
    originals.clear()
  }
}
