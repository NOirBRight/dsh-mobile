/** Semantic DOM and formal ctx.layout target Adapter. */
import type { InteractionIntent, InteractionTargetAdapter } from './operations.ts'
import type { InteractionSurfaceKind, InteractionSurfaceStack } from './surface-stack.ts'

interface LayoutFace {
  toggleSidebar(): void
  closeDetails(): void
}

interface LayoutContext {
  get?(name: string, strict?: boolean): unknown
  layout?: unknown
}

function layoutFrom(ctx: LayoutContext): LayoutFace | undefined {
  let value: unknown
  try {
    value = ctx.get?.('layout', false) ?? ctx.layout
  } catch {
    return undefined
  }
  if (value === null || typeof value !== 'object') return undefined
  const candidate = value as Partial<LayoutFace>
  if (typeof candidate.toggleSidebar !== 'function' || typeof candidate.closeDetails !== 'function') return undefined
  return candidate as LayoutFace
}

function asElement(target: EventTarget | null): Element | null {
  return target instanceof Element ? target : null
}

function isPresented(element: Element): boolean {
  if (element.getClientRects().length === 0) return false
  const rect = element.getBoundingClientRect()
  const view = element.ownerDocument.defaultView
  if (view !== null && (rect.bottom <= 0 || rect.right <= 0 || rect.top >= view.innerHeight || rect.left >= view.innerWidth)) return false
  for (let current: Element | null = element; current !== null; current = current.parentElement) {
    if (current.hasAttribute('hidden') || current.getAttribute('aria-hidden') === 'true') return false
    const style = getComputedStyle(current)
    if (style.display === 'none' || style.visibility === 'hidden') return false
  }
  return true
}

function topPresented(document: Document, selector: string): Element | null {
  const candidates = document.querySelectorAll(selector)
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index]
    if (candidate !== undefined && isPresented(candidate)) return candidate
  }
  return null
}

function modalSurface(document: Document): Element | null {
  return topPresented(document, '[role="dialog"][aria-modal="true"]')
}

function transientSurface(document: Document): Element | null {
  return topPresented(document, '[role="menu"], [role="listbox"], [role="dialog"]:not([aria-modal="true"])')
    ?? topPresented(document, '[aria-haspopup="tree"][aria-expanded="true"]')
}

function dispatchEscape(target: Element): void {
  target.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Escape', code: 'Escape', bubbles: true, cancelable: true,
  }))
}

function dismissFocusedEditable(document: Document): boolean {
  const active = document.activeElement
  if (!(active instanceof HTMLElement)) return false
  if (!(active instanceof HTMLInputElement) && !(active instanceof HTMLTextAreaElement) && !active.isContentEditable) return false
  const view = document.defaultView
  const viewport = view?.visualViewport
  if (
    view === null || view === undefined || viewport === null || viewport === undefined
    || Math.abs(viewport.scale - 1) > 0.01
    || view.innerHeight - viewport.height < 80
  ) return false
  active.blur()
  return true
}

function minimizeQuestion(document: Document): boolean {
  const body = topPresented(document, '[data-question-scroll]')
  const card = body?.parentElement
  const button = card?.querySelector<HTMLButtonElement>('header button[aria-expanded="true"]')
  if (button === null || button === undefined) return false
  button.click()
  return true
}

function dismissRegistered(stack: InteractionSurfaceStack | undefined, intent: InteractionIntent, kinds: readonly InteractionSurfaceKind[]): boolean {
  return stack?.handle(intent, kinds) ?? false
}

function contextButton(target: EventTarget | null): HTMLButtonElement | null {
  const row = asElement(target)?.closest('[role="treeitem"]')
  if (row === null || row === undefined) return null
  const hosts = Array.from(row.querySelectorAll<HTMLElement>('[data-dsh-touch-action-host]'))
  const host = hosts.at(-1)
  if (host === undefined) return null
  const buttons = Array.from(host.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
  // Workspace rows put the Menu anchor in a nested wrapper and New Session
  // directly in the action host. Prefer the nested official menu anchor.
  return buttons.find(button => button.parentElement !== host) ?? buttons[0] ?? null
}

function popupButton(target: EventTarget | null): HTMLButtonElement | null {
  const button = asElement(target)?.closest('button[aria-haspopup]')
  return button instanceof HTMLButtonElement ? button : null
}

/** Create the compatibility target Adapter without importing an upstream feature module. */
export function createDomTargetAdapter(
  ctx: LayoutContext,
  document: Document = globalThis.document,
  surfaces?: InteractionSurfaceStack,
): InteractionTargetAdapter {
  return {
    name: 'semantic-dom',
    handle(intent: InteractionIntent): boolean {
      if (intent.type === 'back') {
        if (dismissFocusedEditable(document)) return true
        if (dismissRegistered(surfaces, intent, ['modal'])) return true
        const modal = modalSurface(document)
        if (modal !== null) {
          const profileClose = modal.closest('[data-dsh-profile-menu]')?.querySelector<HTMLButtonElement>('[data-profile-close]')
          if (profileClose !== null && profileClose !== undefined) profileClose.click()
          else dispatchEscape(modal)
          return true
        }
        const profileClose = document.querySelector<HTMLButtonElement>('[data-dsh-profile-menu] [data-profile-close]')
        if (profileClose !== null) {
          profileClose.click()
          return true
        }
        if (dismissRegistered(surfaces, intent, ['takeover'])) return true
        if (minimizeQuestion(document)) return true
        if (dismissRegistered(surfaces, intent, ['popup'])) return true
        const transient = transientSurface(document)
        if (transient !== null) {
          dispatchEscape(transient)
          return true
        }
        if (dismissRegistered(surfaces, intent, ['details'])) return true
        const frame = document.querySelector<HTMLElement>('[data-details-open], [data-drawer-open]')
        if (frame?.hasAttribute('data-details-open') === true) {
          const layout = layoutFrom(ctx)
          if (layout === undefined) throw new Error('interaction-operations: details is open but ctx.layout is unavailable')
          layout.closeDetails()
          return true
        }
        if (dismissRegistered(surfaces, intent, ['navigation'])) return true
        if (frame?.hasAttribute('data-drawer-open') === true) {
          const layout = layoutFrom(ctx)
          if (layout === undefined) throw new Error('interaction-operations: drawer is open but ctx.layout is unavailable')
          layout.toggleSidebar()
          return true
        }
        return false
      }

      if (intent.type === 'open-navigation' || intent.type === 'close-navigation') {
        const frame = document.querySelector<HTMLElement>('[data-mobile-topbar]')?.parentElement
        if (frame === null || frame === undefined) return false
        const open = frame.hasAttribute('data-drawer-open')
        if ((intent.type === 'open-navigation' && open) || (intent.type === 'close-navigation' && !open)) return true
        const layout = layoutFrom(ctx)
        if (layout === undefined) throw new Error('interaction-operations: navigation intent requires ctx.layout')
        layout.toggleSidebar()
        return true
      }

      if (intent.type === 'open-context-actions') {
        const button = contextButton(intent.target)
        if (button === null) return false
        button.click()
        return true
      }

      const button = popupButton(intent.target)
      if (button === null || button.getAttribute('aria-expanded') === 'true') return button !== null
      button.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'ArrowDown', code: 'ArrowDown', bubbles: true, cancelable: true,
      }))
      return true
    },
  }
}
