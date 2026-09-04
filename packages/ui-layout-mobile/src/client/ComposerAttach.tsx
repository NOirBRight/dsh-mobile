/**
 * Narrow plus-button attach. Renders only through a portal so the composer
 * tool row does not gain extra flex items (which wrap the model picker).
 * The menu uses the official primitives Menu, matching PermissionSelect.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  IMAGE_ACCEPT,
  attachFiles,
  blurComposer,
  composerCardHasDraft,
  composerControlButton,
  composerDraftActionButton,
  composerDraftInput,
  composerSendIsBusy,
  dismissOfficialMenus,
  draftPayload,
  resolveMobileSendMode,
  isComposerStopLabel,
  filesFromInput,
  isComposerPlusButton,
  plusMenuAlreadyOpen,
  type DraftConversation,
  type DraftInputActions,
} from './composer-attach.ts'
import css from './ComposerAttach.module.css'

export interface ComposerAttachProps {
  inputActions?: DraftInputActions
  session?: { readonly running: boolean; readonly subagent: unknown | null }
  input?: { readonly draft: string; readonly imageIds: readonly string[] }
  busyEnter?: () => 'queue' | 'steer'
  submitDraft?: (text: string, imageIds: readonly string[], mode: 'queue' | 'steer') => Promise<'machine' | 'copied'>
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
  inputActions,
  session,
  input,
  busyEnter,
  submitDraft,
  createDraftImages,
  releaseDraftImage,
  releaseDraftImages,
}: ComposerAttachProps) {
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const plusRef = useRef<HTMLButtonElement | null>(null)
  const skipNextPlusRef = useRef(false)
  const sendPendingRef = useRef(false)
  const [open, setOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

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
    const onPointerDown = (event: PointerEvent): void => {
      if (skipNextPlusRef.current) return
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
        event.preventDefault()
        event.stopImmediatePropagation()
        const textarea = composerDraftInput(draftAction)
        if (textarea !== null) {
          const busy = composerSendIsBusy(draftAction, session?.running)
          const mode = resolveMobileSendMode({
            busy,
            steeringAvailable: session?.subagent == null,
            busyEnter: busyEnter?.(),
          })
          if (busy && submitDraft !== undefined) {
            if (sendPendingRef.current) return
            sendPendingRef.current = true
            const { text, imageIds } = draftPayload(textarea, input)
            void submitDraft(text, [...imageIds], mode).then((how) => {
              if (how !== 'copied') return
              inputActions?.setDraft?.('')
              for (const id of imageIds) inputActions?.removeImage?.(id)
            }).catch((error: unknown) => {
              setToast(error instanceof Error ? error.message : '发送失败')
            }).finally(() => { sendPendingRef.current = false })
            blurComposer()
            return
          }
          // Older Host without sendSession: synthetic Enter may still hit
          // resolveSubmitMode. inputActions.submit() is queue-only — skip it
          // when Settings asked for steer.
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
          if (notCanceled && mode === 'queue' && typeof inputActions?.submit === 'function') {
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
      if (plus === null) return
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
  }, [busyEnter, input, inputActions, session, submitDraft])

  useEffect(() => {
    const setDraftGlyph = (button: HTMLButtonElement, active: boolean): void => {
      const glyph = button.querySelector<SVGSVGElement>('[data-mobile-send-glyph]')
      if (active) {
        if (glyph !== null) return
        const sendGlyph = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        sendGlyph.setAttribute('width', '16')
        sendGlyph.setAttribute('height', '16')
        sendGlyph.setAttribute('viewBox', '0 0 16 16')
        sendGlyph.setAttribute('aria-hidden', 'true')
        sendGlyph.setAttribute('data-mobile-send-glyph', 'true')
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        path.setAttribute('d', 'M8.3125 0.980183C8.66767 1.0531 8.97902 1.20418 9.2627 1.43233C9.48724 1.61297 9.73029 1.85793 9.97949 2.10714L14.707 6.83468L13.293 8.24874L9 3.95577V15.0417H7V3.95577L2.70703 8.24874L1.29297 6.83468L6.02051 2.10714C6.26971 1.85793 6.51277 1.61297 6.7373 1.43233C6.97662 1.23986 7.28445 1.04402 7.6875 0.980183C7.8973 0.947006 8.1031 0.95516 8.3125 0.980183Z')
        path.setAttribute('fill', 'currentColor')
        sendGlyph.append(path)
        button.append(sendGlyph)
        return
      }
      glyph?.remove()
    }

    const originalStopLabel = (button: HTMLButtonElement): string | null => {
      return button.dataset.mobileStopLabel ?? button.getAttribute('aria-label')
    }

    const restoreStopLabel = (button: HTMLButtonElement): void => {
      const original = button.dataset.mobileStopLabel
      if (original === undefined) return
      button.setAttribute('aria-label', original)
      delete button.dataset.mobileStopLabel
    }

    const sendLabelFor = (button: HTMLButtonElement): string => {
      return /^(?:停止|发送)/.test(originalStopLabel(button) ?? '') ? '发送消息' : 'Send message'
    }

    const syncDraftPrimaryAction = (): void => {
      for (const card of document.querySelectorAll<HTMLElement>('[data-composer-card]')) {
        const hasDraft = composerCardHasDraft(card)
        const stops = Array.from(card.querySelectorAll<HTMLButtonElement>('button[aria-label]'))
          .filter(button => isComposerStopLabel(originalStopLabel(button)))
        const primary = hasDraft ? stops.at(-1) ?? null : null
        for (const marked of card.querySelectorAll<HTMLButtonElement>('[data-mobile-send-draft]')) {
          if (marked === primary) continue
          marked.removeAttribute('data-mobile-send-draft')
          setDraftGlyph(marked, false)
          restoreStopLabel(marked)
        }
        for (const stop of stops) {
          const active = stop === primary
          if (active) {
            stop.setAttribute('data-mobile-send-draft', 'true')
            if (stop.dataset.mobileStopLabel === undefined) {
              stop.dataset.mobileStopLabel = stop.getAttribute('aria-label') ?? ''
            }
            const label = sendLabelFor(stop)
            if (stop.getAttribute('aria-label') !== label) stop.setAttribute('aria-label', label)
          } else {
            stop.removeAttribute('data-mobile-send-draft')
            restoreStopLabel(stop)
          }
          setDraftGlyph(stop, active)
        }
      }
    }
    const observer = new MutationObserver(syncDraftPrimaryAction)
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-label'],
    })
    document.addEventListener('input', syncDraftPrimaryAction, true)
    syncDraftPrimaryAction()
    return () => {
      observer.disconnect()
      document.removeEventListener('input', syncDraftPrimaryAction, true)
    }
  }, [])

  // ContextMeter's panel anchors 8px above its trigger (official geometry).
  // A 264px panel off a right-edge trigger can overflow the phone's right
  // edge; clamp only the horizontal overflow, leaving the Host's anchor alone.
  useEffect(() => {
    const clampDialogs = (): void => {
      for (const panel of document.querySelectorAll<HTMLElement>('[data-composer-card] [role="dialog"]:not([aria-modal])')) {
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

  return createPortal(
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
  )
}
