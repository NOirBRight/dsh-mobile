/** Narrow composer plus-button attach helpers. Pure: no React, no cordis. */

import { isComposerSendLabel, isComposerStopLabel } from './chrome-anchors.ts'

export { isComposerSendLabel, isComposerStopLabel } from './chrome-anchors.ts'

export interface DraftInputActions {
  /** Official session input action; optional for older Hosts using the fallback bridge. */
  submit?(): void
}

/** Identify the official composer plus (commands) button without CSS-module class names. */
export function isComposerPlusButton(target: EventTarget | null): HTMLButtonElement | null {
  if (!(target instanceof Element)) return null
  const button = target.closest('button[aria-haspopup="listbox"]')
  if (!(button instanceof HTMLButtonElement)) return null
  if (button.closest('[data-composer-card]') === null) return null
  return button
}

/** Identify any official composer toolbar button without touching its feature behavior. */
export function composerControlButton(target: EventTarget | null): HTMLButtonElement | null {
  if (!(target instanceof Element)) return null
  if (target.closest('[role="menu"], [role="listbox"], [role="dialog"]') !== null) return null
  const button = target.closest('button')
  if (!(button instanceof HTMLButtonElement)) return null
  if (button.closest('[data-composer-card]') === null) return null
  return button
}

function composerCardForButton(button: HTMLButtonElement): HTMLElement | null {
  return button.closest<HTMLElement>('[data-composer-card]')
}

type ComposerDraftElement = HTMLTextAreaElement | HTMLElement

function composerDraftElement(card: HTMLElement): ComposerDraftElement | null {
  const textarea = card.querySelector('textarea')
  if (textarea instanceof HTMLTextAreaElement) return textarea
  return card.querySelector<HTMLElement>('[data-composer-input]')
}

/** True when the card holds any sendable draft: text OR official image rail. */
export function composerCardHasDraft(card: HTMLElement): boolean {
  const input = composerDraftElement(card)
  const text = input instanceof HTMLTextAreaElement ? input.value : input?.textContent
  if (text?.trim() !== '') return true
  // The official image rail is the semantic draft-attachment group above the
  // toolbar; thumbnails mean the card has content even when its editor is empty.
  return card.querySelector('[role="group"] img') !== null
}

function composerDraftForCard(card: HTMLElement): ComposerDraftElement | null {
  const input = composerDraftElement(card)
  return input !== null && composerCardHasDraft(card) ? input : null
}

/** Stop-owned seats in one composer card, in DOM order. */
function stopOwnedSeats(card: HTMLElement): HTMLButtonElement[] {
  return Array.from(card.querySelectorAll<HTMLButtonElement>('button[aria-label]'))
    .filter(button => isStopOwnedSeat(button))
}

/** True for a Stop-owned seat. */
function isStopOwnedSeat(button: HTMLButtonElement): boolean {
  return isComposerStopLabel(button.dataset.mobileStopLabel ?? button.getAttribute('aria-label'))
}

/**
 * Genuine Send seat in one composer card, if any. Core renders a single
 * primary button: main seats show Send XOR Stop, while a running continuable
 * child shows Send AND a separate interrupt Stop.
 */
export function composerCardSendSeat(card: HTMLElement): HTMLButtonElement | null {
  const buttons = Array.from(card.querySelectorAll<HTMLButtonElement>('button[aria-label]'))
  return buttons.find(button =>
    isComposerSendLabel(button.getAttribute('aria-label')) && !isStopOwnedSeat(button),
  ) ?? null
}

/** Owned hiding marker: the one secondary seat the footer keeps out of sight. */
export const SECONDARY_HIDDEN_MARKER = 'data-mobile-secondary-hidden'

/**
 * The secondary seat a phone footer hides so one card keeps ONE primary. Only
 * a running continuable child shows genuine Send AND a separate interrupt
 * Stop: a disabled Send hides (Stop owns interrupt, also while both are
 * disabled mid-interrupt), otherwise the Stop hides beside the usable Send.
 * Main seats show Send XOR Stop and never hide either.
 */
export function composerSecondarySeat(card: HTMLElement): HTMLButtonElement | null {
  const send = composerCardSendSeat(card)
  if (send === null) return null
  const stop = stopOwnedSeats(card).at(-1) ?? null
  if (stop === null) return null
  return send.disabled ? send : stop
}

/**
 * Identify the Send seat that has a real draft behind it. Core already renders
 * Send as the primary whenever a draft is actionable (busy or idle), so Stop
 * seats always keep their interrupt role — including a continuable-child Stop
 * beside its genuine Send, and a blocked main Stop beside a draft.
 */
export function composerDraftActionButton(target: EventTarget | null): HTMLButtonElement | null {
  const button = composerControlButton(target)
  if (button === null) return null
  const card = composerCardForButton(button)
  if (card === null || composerDraftForCard(card) === null) return null
  if (isComposerSendLabel(button.getAttribute('aria-label'))) return button
  return null
}

/** Return the draft editor associated with a primary action, if it is non-empty. */
export function composerDraftInput(button: HTMLButtonElement): ComposerDraftElement | null {
  const card = composerCardForButton(button)
  return card === null ? null : composerDraftForCard(card)
}

/**
 * The official composer editor: Lexical's contenteditable host, or a legacy
 * textarea still rendered by an older Host.
 */
export function composerEditor(target: EventTarget | null): HTMLElement | null {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return null
  return target.closest<HTMLElement>('[data-composer-input], [data-composer-card] textarea')
}

/** Dismiss the composer editor so toolbar actions do not summon the phone keyboard. */
export function blurComposer(): void {
  const el = document.activeElement
  if (el instanceof HTMLInputElement && el.type !== 'file') {
    el.blur()
    return
  }
  const editor = composerEditor(el)
  if (editor !== null) editor.blur()
  else if (el instanceof HTMLTextAreaElement) el.blur()
}

/**
 * Plus pointerdown/mousedown: stop InputBar keepFocus from re-focusing the
 * editor. Do not preventDefault — a canceled pointerdown/touchstart on
 * Android WebView swallows the later click that opens the official listbox,
 * and also keeps the editor focused so the IME stays up.
 * @param event - capture-phase pointer or mouse event.
 * @returns true when this event targeted the composer plus.
 */
export function silencePlusKeepFocus(event: Event): boolean {
  const plus = isComposerPlusButton(event.target)
  if (plus === null) return false
  event.stopImmediatePropagation()
  plus.focus({ preventScroll: true })
  return true
}

/**
 * Close official document-owned menus before a phone toolbar action.
 * Current official primitives listen for pointerdown while older controls listen
 * for mousedown, so send both outside signals explicitly.
 * @param target - dispatch target. Body closes every document-owned menu,
 * including the slash listbox. Dispatching on the composer card closes
 * foreign menus (mode, model) without MenuView treating it as an outside
 * dismiss of the slash listbox the plus click is about to toggle.
 */
export function dismissOfficialMenus(target: EventTarget | null = typeof document === 'undefined' ? null : document.body): void {
  if (target === null) return
  const pointer = typeof PointerEvent === 'function'
    ? new PointerEvent('pointerdown', { bubbles: true, cancelable: true })
    : new Event('pointerdown', { bubbles: true, cancelable: true })
  target.dispatchEvent(pointer)
  target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }))
}
