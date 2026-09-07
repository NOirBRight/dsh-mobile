/**
 * Narrow plus-button attach. A hidden seat marker rides in its own slot entry
 * (display:contents, never a flex item) so handlers and presentation stay on
 * this seat's own composer card when main and child composers coexist.
 * The menu uses the official primitives Menu, matching PermissionSelect.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-store'
import {
  IMAGE_ACCEPT,
  attachFiles,
  blurComposer,
  composerControlButton,
  composerDraftActionButton,
  composerDraftInput,
  composerSecondarySeat,
  SECONDARY_HIDDEN_MARKER,
  dismissOfficialMenus,
  filesFromInput,
  isComposerPlusButton,
  plusMenuAlreadyOpen,
  type DraftConversation,
  type DraftInputActions,
} from './composer-attach.ts'
import css from './ComposerAttach.module.css'

/** Minimal session state the attach reads through the public selector hook. */
export interface ComposerSessionState {
  readonly running: boolean
  readonly subagent: unknown | null
}

export interface ComposerAttachProps {
  /** Standard session-scope selector hook (Core InputBar reads the same source). */
  useSession: SnapshotSelectorHook<ComposerSessionState>
  inputActions?: DraftInputActions
  createDraftImages: DraftConversation['createDraftImages']
  releaseDraftImage?: DraftConversation['releaseDraftImage']
  releaseDraftImages?: DraftConversation['releaseDraftImages']
}

function glyph(d: string): ReactNode {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d={d} stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const ITEMS: readonly MenuEntry[] = [
  { id: 'command', label: '命令', icon: glyph('M3 4.5h10M3 8h6M3 11.5h10') },
  { id: 'image', label: '插入图片', icon: glyph('M2.5 4.5h11v8h-11zM2.5 10.5l3-3 2 2 2.5-2.5 3.5 3.5M6 7a.75.75 0 1 0 0-1.5A.75.75 0 0 0 6 7z') },
]

export function ComposerAttach({
  useSession,
  inputActions,
  createDraftImages,
  releaseDraftImage,
  releaseDraftImages,
}: ComposerAttachProps) {
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const plusRef = useRef<HTMLButtonElement | null>(null)
  const seatRef = useRef<HTMLSpanElement | null>(null)
  const skipNextPlusRef = useRef(false)
  const [open, setOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  // Live session facts through the public hook. A busy main seat already
  // renders Send as its primary (Core primaryStops), so DOM labels alone
  // cannot tell a busy Send from an idle one.
  const running = useSession(s => s.running) ?? false
  const subagent = useSession(s => s.subagent) ?? null

  const conversation: DraftConversation = {
    createDraftImages,
    releaseDraftImage,
    releaseDraftImages,
  }

  const close = useCallback(() => { setOpen(false) }, [])

  const intake = useCallback((files: readonly File[]) => {
    const outcome = attachFiles(files, conversation, inputActions)
    if (!outcome.ok && outcome.message !== '') setToast(outcome.message)
    close()
  }, [close, createDraftImages, inputActions, releaseDraftImage, releaseDraftImages])

  useEffect(() => {
    // Gestures from another card belong to that card's own seat; ignoring
    // them here keeps two mounted composers from submitting through each other.
    const inOwnCard = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) return false
      const card = seatRef.current?.closest<HTMLElement>('[data-composer-card]')
      return card !== null && card !== undefined && card.contains(target)
    }
    const onPointerDown = (event: PointerEvent): void => {
      if (skipNextPlusRef.current) return
      if (!inOwnCard(event.target)) return
      const plus = isComposerPlusButton(event.target)
      if (plus !== null) {
        if (plusMenuAlreadyOpen(plus)) return
        event.preventDefault()
        event.stopImmediatePropagation()
        plusRef.current = plus
        dismissOfficialMenus()
        blurComposer()
        setOpen(was => !was)
        return
      }
      if (composerDraftActionButton(event.target) !== null) return
      if (composerControlButton(event.target) !== null) blurComposer()
    }
    const onMouseDown = (event: MouseEvent): void => {
      if (!inOwnCard(event.target)) return
      if (isComposerPlusButton(event.target) !== null) {
        event.preventDefault()
        event.stopImmediatePropagation()
        blurComposer()
        return
      }
      const control = composerControlButton(event.target)
      if (control === null) return
      if (composerDraftActionButton(event.target) !== null) return
      // Picker triggers are swallowed below, which would also eat the mousedown
      // an already-open menu listens to for outside-close. Close open menus with
      // our own outside signals first, then swallow the focus-taking mousedown.
      if (control.hasAttribute('aria-haspopup')) dismissOfficialMenus()
      // InputBar's official keepFocus handler runs on mousedown. On a phone
      // that would focus the textarea and summon the IME for Send, Stop, model,
      // permission, and other toolbar actions. Preserve the click itself but
      // cancel only the focus-taking mousedown path.
      event.preventDefault()
      event.stopImmediatePropagation()
      blurComposer()
    }
    const onClick = (event: MouseEvent): void => {
      const draftAction = composerDraftActionButton(event.target)
      if (draftAction !== null) {
        if (!inOwnCard(event.target)) return
        event.preventDefault()
        event.stopImmediatePropagation()
        const textarea = composerDraftInput(draftAction)
        if (textarea !== null) {
          const restoreDisabled = draftAction.disabled
          if (restoreDisabled) draftAction.disabled = false
          textarea.focus({ preventScroll: true })
          const notCanceled = textarea.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true,
          }))
          // inputActions.submit() is queue-only: the fallback when Core did not
          // consume the gesture and this session cannot steer (idle or
          // subagent). A busy ordinary session defers to Core's own queue/steer
          // policy, which already resolved the synthetic Enter above.
          if (notCanceled && !(running && subagent == null) && typeof inputActions?.submit === 'function') {
            inputActions.submit()
          }
          if (restoreDisabled) draftAction.disabled = true
          blurComposer()
        }
        return
      }
      if (skipNextPlusRef.current) {
        skipNextPlusRef.current = false
        return
      }
      const plus = isComposerPlusButton(event.target)
      if (plus === null || !inOwnCard(event.target)) return
      if (plusMenuAlreadyOpen(plus)) return
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('mousedown', onMouseDown, true)
    document.addEventListener('click', onClick, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('mousedown', onMouseDown, true)
      document.removeEventListener('click', onClick, true)
    }
  }, [inputActions, useSession, running, subagent])

  // A running continuable child renders Send AND an interrupt Stop; the phone
  // footer keeps ONE primary by marking the secondary seat hidden (CSS hides
  // it, handlers stay intact). The card and the hidden button are captured up
  // front, so transitions and unmount restore through them instead of a ref
  // that is already null during teardown. Inline styles are never touched.
  useEffect(() => {
    const card = seatRef.current?.closest<HTMLElement>('[data-composer-card]')
    if (card === null || card === undefined) return
    let hidden: HTMLButtonElement | null = null
    const setHidden = (next: HTMLButtonElement | null): void => {
      if (hidden === next) return
      hidden?.removeAttribute(SECONDARY_HIDDEN_MARKER)
      hidden = next
      hidden?.setAttribute(SECONDARY_HIDDEN_MARKER, 'true')
    }
    const syncOwnSecondary = (): void => { setHidden(composerSecondarySeat(card)) }
    const observer = new MutationObserver(syncOwnSecondary)
    // aria-label flips Core primary seats; disabled flips which seat is usable.
    observer.observe(card, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label', 'disabled'] })
    syncOwnSecondary()
    return () => {
      observer.disconnect()
      setHidden(null)
    }
  }, [])

  // ContextMeter's panel anchors 8px above its trigger (official geometry).
  // A 264px panel off a right-edge trigger can overflow the phone's right
  // edge; clamp only the horizontal overflow, leaving the Host's anchor alone.
  useEffect(() => {
    const clampDialogs = (): void => {
      const card = seatRef.current?.closest<HTMLElement>('[data-composer-card]')
      if (card === null || card === undefined) return
      for (const panel of card.querySelectorAll<HTMLElement>('[role="dialog"]:not([aria-modal])')) {
        const rect = panel.getBoundingClientRect()
        const overRight = rect.right - (window.innerWidth - 12)
        const overLeft = 12 - rect.left
        const shift = overRight > 0 ? -overRight : overLeft > 0 ? overLeft : 0
        const next = shift === 0 ? '' : 'translateX(' + Math.round(shift) + 'px)'
        if (panel.style.transform !== next) panel.style.transform = next
      }
    }
    const observer = new MutationObserver(clampDialogs)
    observer.observe(document.documentElement, { subtree: true, childList: true })
    window.addEventListener('resize', clampDialogs)
    clampDialogs()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', clampDialogs)
    }
  }, [])

  useEffect(() => {
    if (toast === null) return
    const timer = window.setTimeout(() => { setToast(null) }, 3200)
    return () => { window.clearTimeout(timer) }
  }, [toast])

  const onSelect = (id: string): void => {
    if (id === 'command') {
      close()
      const plus = plusRef.current
      if (plus === null) return
      skipNextPlusRef.current = true
      plus.click()
      return
    }
    if (id === 'image') {
      imageInputRef.current?.click()
      close()
      return
    }
  }

  const onPicked = (event: ChangeEvent<HTMLInputElement>): void => {
    intake(filesFromInput(event.currentTarget))
    event.currentTarget.value = ''
  }

  if (typeof document === 'undefined') return null

  return (
    <>
      <span ref={seatRef} className={css.seat} aria-hidden data-mobile-attach-seat />
      {createPortal(
        <div className={css.host} aria-hidden={open ? undefined : true}>
          <input
            ref={imageInputRef}
            className={css.fileInput}
            type="file"
            accept={IMAGE_ACCEPT}
            multiple
            tabIndex={-1}
            aria-hidden
            onChange={onPicked}
          />
          <Menu
            open={open}
            portal
            side="top"
            align="start"
            getAnchorRect={() => plusRef.current?.getBoundingClientRect() ?? null}
            anchor={<span className={css.anchor} />}
            items={ITEMS}
            onSelect={onSelect}
            onClose={close}
          />
          {toast !== null && <div className={css.toast} role="status">{toast}</div>}
        </div>,
        document.body,
      )}
    </>
  )
}
