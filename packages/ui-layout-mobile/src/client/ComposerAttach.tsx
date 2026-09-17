/**
 * Narrow composer chrome. The official plus opens the Host command listbox
 * (including `file`). This seat only keeps phone Send/Stop and IME behavior.
 */
import { useEffect, useRef } from 'react'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-store'
import {
  blurComposer,
  composerControlButton,
  composerDraftActionButton,
  composerDraftInput,
  composerSecondarySeat,
  SECONDARY_HIDDEN_MARKER,
  dismissOfficialMenus,
  isComposerKeepFocusSeat,
  silencePlusKeepFocus,
  isComposerPlusButton,
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
}

export function ComposerAttach({
  useSession,
  inputActions,
}: ComposerAttachProps) {
  const seatRef = useRef<HTMLSpanElement | null>(null)
  const running = useSession(s => s.running) ?? false
  const subagent = useSession(s => s.subagent) ?? null

  useEffect(() => {
    const inOwnCard = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) return false
      const card = seatRef.current?.closest<HTMLElement>('[data-composer-card]')
      return card !== null && card !== undefined && card.contains(target)
    }
    const view = globalThis.window
    const keepImeDown = (): void => {
      blurComposer()
      view.requestAnimationFrame(() => { blurComposer() })
      view.setTimeout(() => { blurComposer() }, 0)
    }
    const onPointerDown = (event: Event): void => {
      if (!inOwnCard(event.target)) return
      // Touchstart must not stop or cancel: Android synthesizes click from it.
      // pointerdown + mousedown are enough to block InputBar keepFocus.
      if (event.type === 'touchstart' && isComposerPlusButton(event.target) !== null) {
        isComposerPlusButton(event.target)?.focus({ preventScroll: true })
        keepImeDown()
        return
      }
      if (silencePlusKeepFocus(event)) {
        const plus = isComposerPlusButton(event.target)
        const card = plus?.closest('[data-composer-card]')
        if (card !== null && card !== undefined) dismissOfficialMenus(card)
        keepImeDown()
        return
      }
      const control = composerControlButton(event.target)
      if (control === null) return
      if (composerDraftActionButton(event.target) !== null) return
      // keepFocus is only on plus / send / stop. Permission, plan, and model
      // open on click, so their mousedown must pass through: swallowing it
      // cancels the click on Android WebView and races the picker open.
      if (!isComposerKeepFocusSeat(control)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      blurComposer()
    }
    const onClick = (event: MouseEvent): void => {
      const plus = isComposerPlusButton(event.target)
      if (inOwnCard(event.target) && plus !== null) {
        plus.focus({ preventScroll: true })
        keepImeDown()
        return
      }
      const draftAction = composerDraftActionButton(event.target)
      if (draftAction === null || !inOwnCard(event.target)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      const textarea = composerDraftInput(draftAction)
      if (textarea === null) return
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
      if (notCanceled && !(running && subagent == null) && typeof inputActions?.submit === 'function') {
        inputActions.submit()
      }
      if (restoreDisabled) draftAction.disabled = true
      blurComposer()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('mousedown', onPointerDown, true)
    document.addEventListener('touchstart', onPointerDown, { capture: true, passive: false })
    document.addEventListener('click', onClick, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('mousedown', onPointerDown, true)
      document.removeEventListener('touchstart', onPointerDown, true)
      document.removeEventListener('click', onClick, true)
    }
  }, [inputActions, running, subagent])

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
    observer.observe(card, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label', 'disabled'] })
    syncOwnSecondary()
    return () => {
      observer.disconnect()
      setHidden(null)
    }
  }, [])

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

  if (typeof document === 'undefined') return null

  return <span ref={seatRef} className={css.seat} aria-hidden data-mobile-attach-seat />
}
