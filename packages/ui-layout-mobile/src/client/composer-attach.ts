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

/** Attribute that hides an official slash-menu file row on the phone. */
export const FILE_ROW_HIDDEN_MARKER = 'data-mobile-file-row-hidden'

/** Host slash options that open the official command listbox. */
const OFFICIAL_SLASH_OPTION = '[data-trigger-menu] [role="listbox"] [role="option"]'

/** Host `input.file` (文件 / File) plus the add-file wording of that action. */
const OFFICIAL_FILE_COMMAND_TITLE = /^(?:添加文件|文件|add files?|file)$/i

type SlashOptionFace = {
  childNodes?: ArrayLike<{ textContent?: string | null }>
  textContent?: string | null
  getAttribute(name: string): string | null
  setAttribute(name: string, value: string): void
}

function firstLine(value: string | null | undefined): string {
  const trimmed = (value ?? '').trim()
  const breakAt = trimmed.search(/\r|\n/)
  return breakAt === -1 ? trimmed : trimmed.slice(0, breakAt).trim()
}

/**
 * True for Host file-command titles in both official dictionaries.
 * @param title - visible slash-option title.
 */
export function isOfficialFileCommandTitle(title: string): boolean {
  return OFFICIAL_FILE_COMMAND_TITLE.test(title.trim())
}

/**
 * True when a slash listbox option is the official `file` command row.
 * @param option - a `[role="option"]` in `[data-trigger-menu]`.
 */
export function isOfficialFileCommandRow(option: SlashOptionFace): boolean {
  const nodes = option.childNodes
  if (nodes !== undefined && nodes.length > 0) {
    let sawLabel = false
    for (let index = 0; index < nodes.length; index += 1) {
      const text = firstLine(nodes[index]?.textContent)
      if (text === '') continue
      sawLabel = true
      if (isOfficialFileCommandTitle(text)) return true
    }
    if (sawLabel) return false
  }
  return isOfficialFileCommandTitle((option.textContent ?? '').trim())
}

/**
 * Mark official `file` rows in a Host slash listbox so phone CSS can hide them.
 * Desktop wide never calls this: Mobile Layout (and ComposerAttach) are not the root.
 * @param root - a composer card, or any node that may contain `[data-trigger-menu]`.
 */
export function hideOfficialFileCommandRows(root: { querySelectorAll(selector: string): Iterable<SlashOptionFace> }): void {
  for (const option of root.querySelectorAll(OFFICIAL_SLASH_OPTION)) {
    if (!isOfficialFileCommandRow(option)) continue
    option.setAttribute(FILE_ROW_HIDDEN_MARKER, 'true')
  }
}

/**
 * Watch one composer card and hide official file rows as the slash menu mounts.
 * @param getRoot - the attach seat's `[data-composer-card]`; null until the seat is in the tree.
 * @returns disposer that restores marked rows.
 */
export function installOfficialFileCommandRowHider(getRoot: () => ParentNode | null | undefined): () => void {
  if (typeof document === 'undefined' || document.documentElement === null) return () => {}
  if (typeof MutationObserver !== 'function') return () => {}
  const originals = new Map<Element, string | null>()
  const scan = (): void => {
    const root = getRoot()
    const live = new Set<Element>()
    if (root !== null && root !== undefined) {
      for (const option of root.querySelectorAll(OFFICIAL_SLASH_OPTION)) {
        if (!isOfficialFileCommandRow(option)) continue
        live.add(option)
        if (!originals.has(option)) originals.set(option, option.getAttribute(FILE_ROW_HIDDEN_MARKER))
        option.setAttribute(FILE_ROW_HIDDEN_MARKER, 'true')
      }
    }
    for (const [option, original] of originals) {
      if (live.has(option)) continue
      if (original === null) option.removeAttribute(FILE_ROW_HIDDEN_MARKER)
      else option.setAttribute(FILE_ROW_HIDDEN_MARKER, original)
      originals.delete(option)
    }
  }
  const observer = new MutationObserver(scan)
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true })
  scan()
  return () => {
    observer.disconnect()
    for (const [option, original] of originals) {
      if (original === null) option.removeAttribute(FILE_ROW_HIDDEN_MARKER)
      else option.setAttribute(FILE_ROW_HIDDEN_MARKER, original)
    }
    originals.clear()
  }
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
