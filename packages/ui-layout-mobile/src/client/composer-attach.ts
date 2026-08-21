/** Narrow composer plus-button attach helpers. Pure: no React, no cordis. */

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
}

export interface DraftInputActions {
  addImages(ids: readonly string[]): boolean
  /** Official session input action; optional for older Hosts using the fallback bridge. */
  submit?(): void
}

export type AttachOutcome =
  | { ok: true }
  | { ok: false; reason: 'unavailable' | 'busy' | 'unsupported' | 'empty'; message: string }

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
  const button = target.closest('button')
  if (!(button instanceof HTMLButtonElement)) return null
  if (button.closest('[data-composer-card]') === null) return null
  return button
}

const COMPOSER_STOP_LABEL = /^(?:停止生成|停止|stop generating|stop)$/i
const COMPOSER_SEND_LABEL = /^(?:发送消息|发送|send message|send)$/i

/** Match the localized label used by the official primary stop action. */
export function isComposerStopLabel(label: string | null): boolean {
  return label !== null && COMPOSER_STOP_LABEL.test(label.trim())
}

/** Match the localized label used by the official primary send action. */
export function isComposerSendLabel(label: string | null): boolean {
  return label !== null && COMPOSER_SEND_LABEL.test(label.trim())
}

function composerCardForButton(button: HTMLButtonElement): HTMLElement | null {
  return button.closest<HTMLElement>('[data-composer-card]')
}

/** True when the card holds any sendable draft: text OR official image rail. */
export function composerCardHasDraft(card: HTMLElement): boolean {
  const textarea = card.querySelector('textarea')
  if (textarea instanceof HTMLTextAreaElement && textarea.value.trim() !== '') return true
  // The official image rail is the semantic draft-attachment group above the
  // toolbar; thumbnails mean the card has content even when its textarea is empty.
  return card.querySelector('[role="group"] img') !== null
}

function composerDraftForCard(card: HTMLElement): HTMLTextAreaElement | null {
  const textarea = card.querySelector('textarea')
  if (!(textarea instanceof HTMLTextAreaElement) || !composerCardHasDraft(card)) return null
  return textarea
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

/** Return the draft input associated with a primary action, if it is non-empty. */
export function composerDraftInput(button: HTMLButtonElement): HTMLTextAreaElement | null {
  const card = composerCardForButton(button)
  return card === null ? null : composerDraftForCard(card)
}

/** Plus is already holding the slash menu open — let the official toggle close it. */
export function plusMenuAlreadyOpen(button: HTMLButtonElement): boolean {
  return button.getAttribute('aria-expanded') === 'true'
}

/** Dismiss the composer textarea so the plus menu does not summon the phone keyboard. */
export function blurComposer(): void {
  const el = document.activeElement
  if (el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && el.type !== 'file')) el.blur()
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
