import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ComposerAttach } from '../../../../../packages/ui-layout-mobile/src/client/ComposerAttach.tsx'

function dispatch(target: HTMLElement, type: string): void {
  target.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }))
}

interface SessionFace {
  readonly running: boolean
  readonly subagent: unknown | null
}

// Stable fakes shaped like the public selector hooks Core InputBar consumes.
function useMainSession<T>(sel: (s: SessionFace) => T): T {
  return sel({ running: true, subagent: null })
}

function useChildSession<T>(sel: (s: SessionFace) => T): T {
  return sel({ running: true, subagent: { address: { mode: 'continuable' } } })
}

function App() {
  const mainInputRef = useRef<HTMLDivElement>(null)
  const childInputRef = useRef<HTMLDivElement>(null)
  const modeRef = useRef<HTMLDivElement>(null)
  const [modeOpen, setModeOpen] = useState(true)
  const [childAttached, setChildAttached] = useState(true)

  useEffect(() => {
    const outsideModel = (event: MouseEvent): void => {
      if (!(event.target instanceof Element)) return
      if (event.target.closest('#model-menu') !== null) return
      if (event.target.closest('#model-trigger') !== null) return
      document.body.dataset.modelMenuOpen = 'false'
    }
    document.addEventListener('mousedown', outsideModel)
    const outsideMode = (event: PointerEvent): void => {
      if (!(event.target instanceof Node)) return
      if (modeRef.current?.contains(event.target) !== true) setModeOpen(false)
    }
    document.addEventListener('pointerdown', outsideMode)
    const timer = window.setTimeout(() => {
      const plus = document.querySelector<HTMLElement>('#plus')!
      dispatch(plus, 'pointerdown')
      dispatch(plus, 'click')
      window.setTimeout(() => {
        document.body.dataset.modeOpenAfterPlus = String(modeRef.current?.getAttribute('data-open') === 'true')
        const mainSend = document.querySelector<HTMLElement>('#main-send')!
        mainInputRef.current?.blur()
        dispatch(mainSend, 'pointerdown')
        dispatch(mainSend, 'mousedown')
        dispatch(mainSend, 'click')
        document.body.dataset.sendFocus = document.activeElement === mainInputRef.current ? 'input' : 'other'
        window.setTimeout(() => {
          document.body.dataset.mainEntered = document.body.dataset.mainEnter ?? 'false'
          document.body.dataset.mainEnterText = document.body.dataset.mainEnterText ?? ''
          document.body.dataset.mainSubmit = document.body.dataset.mainSubmit ?? 'false'
          document.body.dataset.mainSendHidden = mainSend.getAttribute('data-mobile-secondary-hidden') ?? ''
          const childSend = document.querySelector<HTMLElement>('#child-send')! as HTMLButtonElement
          const childStop = document.querySelector<HTMLElement>('#child-stop')!
          document.body.dataset.childSendHidden = childSend.getAttribute('data-mobile-secondary-hidden') ?? ''
          document.body.dataset.childSendInline = childSend.style.display
          document.body.dataset.childStopHidden = childStop.getAttribute('data-mobile-secondary-hidden') ?? ''
          document.body.dataset.childStopInline = childStop.style.display
          document.body.dataset.childStopLabel = childStop.getAttribute('aria-label') ?? ''
          childInputRef.current!.textContent = 'child follow-up'
          delete document.body.dataset.interruptStopClicked
          delete document.body.dataset.childEnter
          dispatch(childStop, 'pointerdown')
          dispatch(childStop, 'mousedown')
          dispatch(childStop, 'click')
          document.body.dataset.childDraftInterrupt = document.body.dataset.interruptStopClicked ?? 'false'
          document.body.dataset.childDraftEnter = document.body.dataset.childEnter ?? 'false'
          document.body.dataset.childDraftStopLabel = childStop.getAttribute('aria-label') ?? ''
          childSend.disabled = false
          window.setTimeout(() => {
            document.body.dataset.childSendHiddenAfterEnable = childSend.getAttribute('data-mobile-secondary-hidden') ?? ''
            document.body.dataset.childSendInlineAfterEnable = childSend.style.display
            document.body.dataset.childStopHiddenAfterEnable = childStop.getAttribute('data-mobile-secondary-hidden') ?? ''
            document.body.dataset.childStopInlineAfterEnable = childStop.style.display
            const mainEnterCount = document.body.dataset.mainEnterCount ?? '0'
            delete document.body.dataset.childEnter
            delete document.body.dataset.childEnterText
            dispatch(childSend, 'pointerdown')
            dispatch(childSend, 'mousedown')
            dispatch(childSend, 'click')
            window.setTimeout(() => {
              document.body.dataset.childEntered = document.body.dataset.childEnter ?? 'false'
              document.body.dataset.childEnterText = document.body.dataset.childEnterText ?? ''
              document.body.dataset.mainEnterCountAfterChild = (document.body.dataset.mainEnterCount ?? '0') + ':' + mainEnterCount
              childSend.disabled = true
              window.setTimeout(() => {
                document.body.dataset.childSendHiddenBack = childSend.getAttribute('data-mobile-secondary-hidden') ?? ''
                document.body.dataset.childSendInlineBack = childSend.style.display
                document.body.dataset.childStopHiddenBack = childStop.getAttribute('data-mobile-secondary-hidden') ?? ''
                document.body.dataset.childStopInlineBack = childStop.style.display
                setChildAttached(false)
                window.setTimeout(() => {
                  document.body.dataset.childSendHiddenAfterUnmount = childSend.getAttribute('data-mobile-secondary-hidden') ?? ''
                  document.body.dataset.childSendInlineAfterUnmount = childSend.style.display
                  document.body.dataset.childStopHiddenAfterUnmount = childStop.getAttribute('data-mobile-secondary-hidden') ?? ''
                  document.body.dataset.childStopInlineAfterUnmount = childStop.style.display
                  const model = document.querySelector<HTMLElement>('#model-trigger')!
                  const ctxTrigger = document.querySelector<HTMLElement>('#ctx-trigger')!
                  dispatch(model, 'pointerdown')
                  dispatch(model, 'mousedown')
                  dispatch(model, 'click')
                  dispatch(ctxTrigger, 'pointerdown')
                  dispatch(ctxTrigger, 'mousedown')
                  dispatch(ctxTrigger, 'click')
                  window.setTimeout(() => {
                    const panel = document.querySelector<HTMLElement>('#ctx-panel')!
                    const panelRect = panel.getBoundingClientRect()
                    document.body.dataset.modelMenuAfterCtx = document.body.dataset.modelMenuOpen ?? 'unset'
                    document.body.dataset.ctxPanelRight = String(Math.round(panelRect.right))
                    document.body.dataset.ctxPanelTransform = panel.style.transform || 'none'
                    document.body.dataset.ctxPanelBottomDelta = String(Math.round(panelRect.bottom - ctxTrigger.getBoundingClientRect().top))
                    document.body.dataset.ready = 'true'
                  }, 0)
                }, 0)
              }, 0)
            }, 0)
          }, 0)
        }, 0)
      }, 40)
    }, 100)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('pointerdown', outsideMode)
      document.removeEventListener('mousedown', outsideModel)
    }
  }, [])

  return <>
    <div ref={modeRef} data-mode-menu role="menu" data-open={modeOpen ? 'true' : undefined}>Read Only</div>
    <div data-composer-card id="main-card">
      <div
        ref={mainInputRef}
        contentEditable
        suppressContentEditableWarning
        data-composer-input
        data-phase="plain"
        aria-label="message"
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          document.body.dataset.mainEnterCount = String(Number(document.body.dataset.mainEnterCount ?? '0') + 1)
          document.body.dataset.mainEnter = 'true'
          document.body.dataset.mainEnterText = mainInputRef.current?.textContent ?? ''
          event.preventDefault()
        }}
      >main follow-up</div>
      <button id="plus" type="button" aria-haspopup="listbox" aria-expanded="false">Plus</button>
      <button id="main-send" type="button" aria-label="Send message">Send</button>
      <button id="model-trigger" type="button" aria-haspopup="menu" aria-expanded="false" onClick={() => { document.body.dataset.modelMenuOpen = 'true' }}>Model</button>
      <div id="model-menu" role="menu" />
      <span id="ctx-root" style={{ position: 'relative' }}>
        <button id="ctx-trigger" type="button" aria-haspopup="dialog" aria-expanded="true">ctx</button>
        <div id="ctx-panel" role="dialog" className="ctx-panel" />
      </span>
      <ComposerAttach
        useSession={useMainSession}
        inputActions={{
          addImages: () => true,
          submit: () => { document.body.dataset.mainSubmit = 'true' },
        }}
        createDraftImages={() => []}
      />
    </div>
    <div data-composer-card id="child-card">
      <div
        ref={childInputRef}
        contentEditable
        suppressContentEditableWarning
        data-composer-input
        data-phase="plain"
        aria-label="message"
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          document.body.dataset.childEnter = 'true'
          document.body.dataset.childEnterText = childInputRef.current?.textContent ?? ''
          event.preventDefault()
        }}
      />
      <button id="child-send" type="button" aria-label="Send message" disabled>Send</button>
      <button id="child-stop" type="button" aria-label="Stop" onClick={() => { document.body.dataset.interruptStopClicked = 'true' }}><svg width="16" height="16" aria-hidden="true" /></button>
      {childAttached && (
        <ComposerAttach
          useSession={useChildSession}
          inputActions={{
            addImages: () => true,
            submit: () => { document.body.dataset.childSubmit = 'true' },
          }}
          createDraftImages={() => []}
        />
      )}
    </div>
  </>
}

createRoot(document.getElementById('root')!).render(<App />)
