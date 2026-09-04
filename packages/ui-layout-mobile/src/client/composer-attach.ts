/** Narrow composer plus-button attach helpers. Pure: no React, no cordis. */

import { isComposerSendLabel, isComposerStopLabel } from './chrome-anchors.ts'

export { isComposerSendLabel, isComposerStopLabel } from './chrome-anchors.ts'

/** Official image MIME set used by the Host draft-image registry. */
export const IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'] as const

/** File-input accept list for the gallery/camera chooser. */
export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/jpg,image/webp,image/gif'

export interface DraftImage {
  readonly id: string
}

export interface DraftConversation {
  createDraftImages(files: readonly File[]): readonly DraftImage[]
  releaseDraftImage?(id: string): void
  releaseDraftImages?(images: readonly DraftImage[]): void
  sendSession?(
    session: unknown,
    text: string,
    imageIds: readonly string[],
    mode: 'queue' | 'steer',
  ): Promise<unknown>
  /** Official input hub; `shell(id).submit(mode)` keeps draft images on the machine. */
  input?: {
    shell?(id: string): { submit(mode?: 'queue' | 'steer'): void }
  }
}

export interface DraftInputActions {
  addImages(ids: readonly string[]): boolean
  setDraft?(text: string): void
  removeImage?(id: string): void
  /** Official session input action; optional for older Hosts using the fallback bridge. */
  submit?(): void
}

export type AttachOutcome =
  | { ok: true }
  | { ok: false; reason: 'unavailable' | 'busy' | 'unsupported' | 'empty'; message: string }

/** Same values as Host `ui-conversation.busyEnter`. */
export type BusyEnterBehavior = 'queue' | 'steer'

/** Face used to decide whether the intercepted primary is a busy send. */
export interface BusySendButton {
  hasAttribute(name: string): boolean
  readonly dataset: { readonly mobileStopLabel?: string }
  getAttribute(name: string): string | null
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

function primaryStopButton(card: HTMLElement): HTMLButtonElement | null {
  const stops = Array.from(card.querySelectorAll<HTMLButtonElement>('button[aria-label]'))
    .filter(button => isComposerStopLabel(button.dataset.mobileStopLabel ?? button.getAttribute('aria-label')))
  return stops.at(-1) ?? null
}

/**
 * Identify a primary composer action that has a real draft behind it. A busy
 * ordinary session exposes Stop in this seat; on mobile that seat must behave
 * like Send while the draft is non-empty. Continuable child Stop controls are
 * left alone by requiring the last localized Stop button (the primary seat).
 */
export function composerDraftActionButton(target: EventTarget | null): HTMLButtonElement | null {
  const button = composerControlButton(target)
  if (button === null) return null
  const card = composerCardForButton(button)
  if (card === null || composerDraftForCard(card) === null) return null
  if (isComposerSendLabel(button.getAttribute('aria-label'))) return button
  if (isComposerStopLabel(button.getAttribute('aria-label')) && primaryStopButton(card) === button) return button
  return null
}

/** Return the draft editor associated with a primary action, if it is non-empty. */
export function composerDraftInput(button: HTMLButtonElement): ComposerDraftElement | null {
  const card = composerCardForButton(button)
  return card === null ? null : composerDraftForCard(card)
}

/**
 * Busy send on mobile is the Stop seat painted as Send (`data-mobile-send-draft`),
 * not only `session.running` — that snapshot can lag the button.
 */
export function composerSendIsBusy(button: BusySendButton, running?: boolean): boolean {
  return button.hasAttribute('data-mobile-send-draft')
    || isComposerStopLabel(button.dataset.mobileStopLabel ?? null)
    || running === true
}

/**
 * Same rule as official `resolve(running, 'enter', steeringAvailable)`:
 * idle or subagent → queue; busy ordinary session → the Settings preference.
 */
export function resolveMobileSendMode(args: {
  busy: boolean
  steeringAvailable: boolean
  busyEnter?: BusyEnterBehavior
}): BusyEnterBehavior {
  if (!args.busy || !args.steeringAvailable) return 'queue'
  return args.busyEnter ?? 'queue'
}

/** Live editor text plus snapshot image ids (fallback when machine submit is unavailable). */
export function draftPayload(
  editor: HTMLElement,
  input?: { readonly draft: string; readonly imageIds: readonly string[] },
): { text: string; imageIds: readonly string[] } {
  const liveText = typeof HTMLTextAreaElement !== 'undefined' && editor instanceof HTMLTextAreaElement
    ? editor.value
    : (editor.textContent ?? '')
  if (input === undefined) return { text: liveText, imageIds: [] }
  return { text: liveText !== '' ? liveText : input.draft, imageIds: input.imageIds }
}

/** Plus is already holding the slash menu open — let the official toggle close it. */
export function plusMenuAlreadyOpen(button: HTMLButtonElement): boolean {
  return button.getAttribute('aria-expanded') === 'true'
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
 * Close official document-owned menus before the mobile attach menu opens.
 * Current official primitives listen for pointerdown while older controls listen
 * for mousedown, so send both outside signals explicitly.
 */
export function dismissOfficialMenus(): void {
  if (typeof document === 'undefined' || document.body === null) return
  const pointer = typeof PointerEvent === 'function'
    ? new PointerEvent('pointerdown', { bubbles: true, cancelable: true })
    : new Event('pointerdown', { bubbles: true, cancelable: true })
  document.body.dispatchEvent(pointer)
  document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }))
}

export function filesFromInput(input: HTMLInputElement): File[] {
  return Array.from(input.files ?? [])
}

/**
 * Hand files to the official composer drop listener (InputBar document-level
 * intake). Returns true when that listener ran (`preventDefault`).
 */
export function dispatchOfficialFileDrop(files: readonly File[]): boolean {
  if (files.length === 0) return false
  if (typeof document === 'undefined' || typeof DataTransfer === 'undefined' || typeof DragEvent === 'undefined') return false
  try {
    const transfer = new DataTransfer()
    for (const file of files) transfer.items.add(file)
    if (transfer.files.length !== files.length) return false
    const event = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })
    document.dispatchEvent(event)
    return event.defaultPrevented
  } catch {
    return false
  }
}

export function unsupportedImageMessage(): string {
  return '仅支持 PNG、JPG、WebP、GIF 格式的图片'
}

export function attachUnavailableMessage(): string {
  return '当前会话还不能添加图片'
}

export function attachBusyMessage(): string {
  return '正在发送，请稍后再添加图片'
}

/**
 * Register browser files as official draft images and append them to the
 * composer. Non-images fail as a whole batch, matching Host intake.
 */
export function attachFiles(
  files: readonly File[],
  conversation: DraftConversation | undefined,
  inputActions: DraftInputActions | undefined,
): AttachOutcome {
  if (files.length === 0) return { ok: false, reason: 'empty', message: '' }
  if (dispatchOfficialFileDrop(files)) return { ok: true }
  if (conversation?.createDraftImages === undefined || inputActions === undefined) {
    return { ok: false, reason: 'unavailable', message: attachUnavailableMessage() }
  }
  try {
    const images = conversation.createDraftImages(files)
    if (!inputActions.addImages(images.map(image => image.id))) {
      releaseDrafts(conversation, images)
      return { ok: false, reason: 'busy', message: attachBusyMessage() }
    }
    return { ok: true }
  } catch (error) {
    const unsupported = error !== null && typeof error === 'object' && (
      (error as { name?: string }).name === 'UnsupportedImageMediaTypeError'
      || /unsupported image media type/i.test(String((error as { message?: string }).message ?? error))
    )
    return {
      ok: false,
      reason: unsupported ? 'unsupported' : 'unavailable',
      message: unsupported ? unsupportedImageMessage() : attachUnavailableMessage(),
    }
  }
}

function releaseDrafts(conversation: DraftConversation, images: readonly DraftImage[]): void {
  if (typeof conversation.releaseDraftImages === 'function') {
    conversation.releaseDraftImages(images)
    return
  }
  if (typeof conversation.releaseDraftImage === 'function') {
    for (const image of images) conversation.releaseDraftImage(image.id)
  }
}
