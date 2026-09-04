/** Coarse-pointer affordances, long press, and narrow navigation swipes. */
import type { IInteractionOperations } from './operations.ts'

const LONG_PRESS_MS = 500
const MOVE_SLOP_PX = 10
const SWIPE_DISTANCE_PX = 56
const EDGE_START_PX = 24
const SWIPE_MAX_MS = 800

const TOUCH_STYLES = [
  '@media (hover: none), (pointer: coarse) {',
  '  [data-dsh-touch-action-row] { min-height: 40px !important; height: auto !important; }',
  '  [data-dsh-touch-action-host] { display: inline-flex !important; align-items: center !important; }',
  '  [data-dsh-touch-action-host] button { min-width: 28px !important; min-height: 28px !important; }',
  '  [data-dsh-touch-reveal] { opacity: 1 !important; pointer-events: auto !important; }',
  '}',
].join('\n')

interface PointerTrack {
  pointerId: number
  x: number
  y: number
  startedAt: number
  row: HTMLElement | null
  gesture: 'open-navigation' | 'close-navigation' | null
  timer: number | undefined
}

function directChildWithin(row: Element, descendant: Element): HTMLElement | null {
  let current: Element | null = descendant
  while (current !== null && current.parentElement !== row) current = current.parentElement
  return current instanceof HTMLElement ? current : null
}

function annotate(root: ParentNode): void {
  const rows = new Set<Element>(root.querySelectorAll('[role="treeitem"]'))
  if (root instanceof Element) {
    const ownerRow = root.closest('[role="treeitem"]')
    if (ownerRow !== null) rows.add(ownerRow)
  }
  for (const row of rows) {
    const buttons = Array.from(row.querySelectorAll('button[aria-label]'))
    const hosts = new Set(buttons.map(button => directChildWithin(row, button)).filter((value): value is HTMLElement => value !== null))
    for (const host of hosts) {
      host.setAttribute('data-dsh-touch-action-host', '')
      row.setAttribute('data-dsh-touch-action-row', '')
    }
  }

  const buttons = root instanceof HTMLButtonElement ? [root] : Array.from(root.querySelectorAll('button'))
  for (const button of buttons) {
    if (button.hasAttribute('data-dsh-touch-reveal')) continue
    const style = getComputedStyle(button)
    if (Number(style.opacity) !== 0 || style.display === 'none' || style.visibility === 'hidden') continue
    if (button.getClientRects().length === 0) continue
    button.setAttribute('data-dsh-touch-reveal', '')
  }
}

function clearTimer(track: PointerTrack | null, window: Window): void {
  if (track?.timer !== undefined) window.clearTimeout(track.timer)
  if (track !== null) track.timer = undefined
}

function isInteractive(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('button, a, input, textarea, select, [contenteditable="true"]') !== null
}

/** Install all coarse-pointer input Adapters; teardown retracts every effect. */
export function installTouchInputAdapter(
  operations: IInteractionOperations,
  document: Document = globalThis.document,
  window: Window = globalThis.window,
): () => void {
  const style = document.createElement('style')
  style.setAttribute('data-dsh-interaction-affordances', '')
  style.textContent = TOUCH_STYLES
  document.head.append(style)
  annotate(document)

  const observer = new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof Element) annotate(node)
      }
    }
  })
  observer.observe(document.documentElement, { childList: true, subtree: true })

  let track: PointerTrack | null = null
  let suppressRow: HTMLElement | null = null
  let suppressUntil = 0
  let lastTouchPopup: HTMLButtonElement | null = null
  let lastTouchPopupAt = 0
  let lastTouchPopupWasOpen = false

  const onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch' || event.isPrimary === false) return
    const target = event.target instanceof Element ? event.target : null
    const frame = document.querySelector<HTMLElement>('[data-mobile-topbar]')?.parentElement ?? null
    const drawerOpen = frame?.hasAttribute('data-drawer-open') === true
    const drawer = frame?.querySelector(':scope > nav') ?? null
    const inDrawer = drawer !== null && target !== null && drawer.contains(target)
    const gesture = !drawerOpen && event.clientX <= EDGE_START_PX
      ? 'open-navigation'
      : drawerOpen && inDrawer ? 'close-navigation' : null
    const row = isInteractive(event.target) ? null : target?.closest<HTMLElement>('[data-dsh-touch-action-row]') ?? null
    track = {
      pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      startedAt: Date.now(), row, gesture, timer: undefined,
    }
    const popup = target?.closest('button[aria-haspopup]')
    if (popup instanceof HTMLButtonElement) {
      lastTouchPopup = popup
      lastTouchPopupAt = Date.now()
      lastTouchPopupWasOpen = popup.getAttribute('aria-expanded') === 'true'
    }
    if (row !== null) {
      track.timer = window.setTimeout(() => {
        const active = track
        if (active === null || active.row !== row) return
        clearTimer(active, window)
        const outcome = operations.dispatch({
          type: 'open-context-actions', target: row,
          source: { kind: 'touch', detail: 'long-press' },
        })
        if (outcome.status !== 'unhandled') {
          suppressRow = row
          suppressUntil = Date.now() + 750
        }
      }, LONG_PRESS_MS)
    }
  }

  const onPointerMove = (event: PointerEvent): void => {
    if (track === null || event.pointerId !== track.pointerId) return
    if (Math.hypot(event.clientX - track.x, event.clientY - track.y) > MOVE_SLOP_PX) clearTimer(track, window)
  }

  const finishPointer = (event: PointerEvent): void => {
    if (track === null || event.pointerId !== track.pointerId) return
    const active = track
    track = null
    clearTimer(active, window)
    if (active.gesture === null || Date.now() - active.startedAt > SWIPE_MAX_MS) return
    const dx = event.clientX - active.x
    const dy = event.clientY - active.y
    if (Math.abs(dx) < SWIPE_DISTANCE_PX || Math.abs(dx) <= Math.abs(dy) * 1.4) return
    if (active.gesture === 'open-navigation' && dx > 0) {
      operations.dispatch({ type: 'open-navigation', source: { kind: 'touch', detail: 'edge-swipe' } })
    } else if (active.gesture === 'close-navigation' && dx < 0) {
      operations.dispatch({ type: 'close-navigation', source: { kind: 'touch', detail: 'drawer-swipe' } })
    }
  }

  const onPointerCancel = (event: PointerEvent): void => {
    if (track === null || event.pointerId !== track.pointerId) return
    clearTimer(track, window)
    track = null
  }

  const onClick = (event: MouseEvent): void => {
    if (suppressRow !== null && Date.now() < suppressUntil && event.target instanceof Node && suppressRow.contains(event.target)) {
      event.preventDefault()
      event.stopImmediatePropagation()
      suppressRow = null
      return
    }
    const button = event.target instanceof Element ? event.target.closest('button[aria-haspopup]') : null
    if (!(button instanceof HTMLButtonElement) || button !== lastTouchPopup || Date.now() - lastTouchPopupAt > 750) return
    const wasOpenOnPointerDown = lastTouchPopupWasOpen
    window.queueMicrotask(() => {
      if (!button.isConnected) return
      const stillOpen = button.getAttribute('aria-expanded') === 'true'
      if (wasOpenOnPointerDown) {
        if (stillOpen) button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
        return
      }
      if (!stillOpen) operations.dispatch({ type: 'open-popup', target: button, source: { kind: 'touch', detail: 'tap-fallback' } })
    })
  }

  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('pointermove', onPointerMove, true)
  document.addEventListener('pointerup', finishPointer, true)
  document.addEventListener('pointercancel', onPointerCancel, true)
  document.addEventListener('click', onClick, true)

  return () => {
    observer.disconnect()
    clearTimer(track, window)
    document.removeEventListener('pointerdown', onPointerDown, true)
    document.removeEventListener('pointermove', onPointerMove, true)
    document.removeEventListener('pointerup', finishPointer, true)
    document.removeEventListener('pointercancel', onPointerCancel, true)
    document.removeEventListener('click', onClick, true)
    for (const element of document.querySelectorAll('[data-dsh-touch-action-host], [data-dsh-touch-action-row], [data-dsh-touch-reveal]')) {
      element.removeAttribute('data-dsh-touch-action-host')
      element.removeAttribute('data-dsh-touch-action-row')
      element.removeAttribute('data-dsh-touch-reveal')
    }
    style.remove()
  }
}
