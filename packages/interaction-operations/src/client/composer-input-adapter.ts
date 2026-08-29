/** Mobile composer keyboard policy: plain Enter is a newline, never submit. */

function composerInput(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null
  const input = target.closest<HTMLElement>('textarea[data-phase], [data-composer-input][data-phase]')
  return input instanceof HTMLTextAreaElement || input instanceof HTMLElement ? input : null
}

function editable(input: HTMLElement | null): boolean {
  if (input instanceof HTMLTextAreaElement) return !input.disabled && !input.readOnly
  return input !== null && input.getAttribute('contenteditable') === 'true'
    && input.getAttribute('aria-disabled') !== 'true'
}

function selectionPopupOpen(document: Document): boolean {
  for (const element of document.querySelectorAll('[role="menu"], [role="listbox"], [aria-haspopup="tree"][aria-expanded="true"]')) {
    const style = getComputedStyle(element)
    if (!element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true' &&
      style.display !== 'none' && style.visibility !== 'hidden') return true
  }
  return false
}

export interface MobileEnterPolicyInput {
  key: string
  trusted: boolean
  editable: boolean
  composing: boolean
  legacyKeyCode: number
  shift: boolean
  control: boolean
  meta: boolean
  alt: boolean
  selectionPopupOpen: boolean
}

/** Pure policy behind the capture Adapter; exposed so the invariant is testable. */
export function mobileEnterAction(input: MobileEnterPolicyInput): 'newline' | 'upstream' {
  if (input.key !== 'Enter' || !input.trusted || !input.editable) return 'upstream'
  // Shift already means newline upstream; Ctrl/Command Enter remains an explicit accelerated shortcut.
  if (input.shift || input.control || input.meta || input.alt) return 'upstream'
  if (input.composing || input.legacyKeyCode === 229 || input.selectionPopupOpen) return 'upstream'
  return 'newline'
}

/** Decide whether a trusted composer Enter should bypass upstream submit logic. */
export function shouldKeepEnterAsNewline(event: KeyboardEvent, document: Document): boolean {
  const input = composerInput(event.target)
  return mobileEnterAction({
    key: event.key,
    trusted: event.isTrusted,
    editable: editable(input),
    composing: event.isComposing,
    legacyKeyCode: event.keyCode,
    shift: event.shiftKey,
    control: event.ctrlKey,
    meta: event.metaKey,
    alt: event.altKey,
    selectionPopupOpen: selectionPopupOpen(document),
  }) === 'newline'
}

/** Apply both event policy and the native keyboard enter-key hint. */
export function installComposerInputAdapter(document: Document = globalThis.document): () => void {
  const originalHints = new Map<HTMLElement, string | null>()

  const annotate = (root: ParentNode): void => {
    const selector = 'textarea[data-phase], [data-composer-input][data-phase]'
    const inputs = root instanceof HTMLElement && root.matches(selector)
      ? [root]
      : Array.from(root.querySelectorAll<HTMLElement>(selector))
    for (const input of inputs) {
      if (originalHints.has(input)) continue
      originalHints.set(input, input.getAttribute('enterkeyhint'))
      input.setAttribute('enterkeyhint', 'enter')
    }
  }

  annotate(document)
  const observer = new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof Element) annotate(node)
      }
    }
  })
  observer.observe(document.documentElement, { childList: true, subtree: true })

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!shouldKeepEnterAsNewline(event, document)) return
    // Do not preventDefault: native textarea insertion is the intended result.
    // Stop before React reaches InputBar's Enter-to-submit handler.
    event.stopImmediatePropagation()
  }
  document.addEventListener('keydown', onKeyDown, true)

  return () => {
    observer.disconnect()
    document.removeEventListener('keydown', onKeyDown, true)
    for (const [input, hint] of originalHints) {
      if (!input.isConnected) continue
      if (hint === null) input.removeAttribute('enterkeyhint')
      else input.setAttribute('enterkeyhint', hint)
    }
    originalHints.clear()
  }
}
