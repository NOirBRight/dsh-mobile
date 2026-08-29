import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ComposerAttach } from '../../../../../packages/ui-layout-mobile/src/client/ComposerAttach.tsx'

function dispatch(target: HTMLElement, type: string): void {
  target.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }))
}

function App() {
  const inputRef = useRef<HTMLDivElement>(null)
  const modeRef = useRef<HTMLDivElement>(null)
  const [modeOpen, setModeOpen] = useState(true)

  useEffect(() => {
    // Model-picker replica: an open menu closes on any outside mousedown, like
    // the official PopupSelect. The mobile bridge must still deliver that signal
    // even while it swallows the picker trigger's own focus-taking mousedown.
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
        const send = document.querySelector<HTMLElement>('#send')!
        const stop = document.querySelector<HTMLElement>('#stop')!
        inputRef.current?.blur()
        dispatch(send, 'pointerdown')
        dispatch(send, 'mousedown')
        dispatch(send, 'click')
        const sendFocus = document.activeElement === inputRef.current ? 'input' : 'other'
        inputRef.current?.blur()
        dispatch(stop, 'pointerdown')
        dispatch(stop, 'mousedown')
        dispatch(stop, 'click')
        document.body.dataset.clickReachedStop = document.body.dataset.stopClicked ?? 'false'
        document.body.dataset.stopDispatchResult = String(stop.dataset.mobileSendDraft !== undefined)
        delete document.body.dataset.stopClicked
        const stopFocus = document.activeElement === inputRef.current ? 'input' : 'other'

        delete document.body.dataset.stopClicked
        inputRef.current!.dataset.mobileBusyPolicy = 'steer'
        inputRef.current!.textContent = 'queued follow-up'
        dispatch(inputRef.current!, 'input')
        // Seam guard: the fixture's React handler must see a synthetic Enter,
        // the same path the mobile bridge uses for the official policy resolver.
        const directEnter = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true })
        const directDispatched = inputRef.current!.dispatchEvent(directEnter)
        document.body.dataset.directEnter = (document.body.dataset.sendViaEnter ?? 'false') + ':' + String(directDispatched)
        delete document.body.dataset.sendViaEnter
        const interruptStop = document.querySelector<HTMLElement>('#interrupt-stop')!
        dispatch(interruptStop, 'pointerdown')
        dispatch(interruptStop, 'mousedown')
        dispatch(interruptStop, 'click')
        const draftMouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
        document.body.dataset.stopMarkedBeforeMousedown = String(stop.dataset.mobileSendDraft === 'true')
        stop.dispatchEvent(draftMouseDown)
        const draftStopMouseDownPrevented = String(draftMouseDown.defaultPrevented)
        const draftClick = new MouseEvent('click', { bubbles: true, cancelable: true })
        stop.dispatchEvent(draftClick)
        window.setTimeout(() => {
          document.body.dataset.modeOpenAfterPlus = String(modeRef.current?.getAttribute('data-open') === 'true')
          document.body.dataset.sendFocus = sendFocus
          document.body.dataset.stopFocus = stopFocus
          document.body.dataset.draftStopMouseDownPrevented = draftStopMouseDownPrevented
          document.body.dataset.draftStopMarked = String(stop.dataset.mobileSendDraft === 'true')
          document.body.dataset.draftStopGlyph = String(stop.querySelector('svg[data-mobile-send-glyph]')?.querySelector('path')?.getAttribute('d')?.startsWith('M8.3125') === true)
          document.body.dataset.draftStopSvgDisplay = getComputedStyle(stop.querySelector('svg')!).display
          document.body.dataset.draftStopFontSize = getComputedStyle(stop).fontSize
          document.body.dataset.draftStopLabel = stop.getAttribute('aria-label') ?? ''
          document.body.dataset.draftSubmit = document.body.dataset.sendViaSubmit ?? 'false'
          document.body.dataset.draftEnter = document.body.dataset.sendViaEnter ?? 'false'
          inputRef.current!.textContent = ''
          dispatch(inputRef.current!, 'input')
          const rail = document.createElement('div')
          rail.setAttribute('role', 'group')
          const thumbnail = document.createElement('img')
          thumbnail.alt = 'draft image'
          rail.append(thumbnail)
          document.querySelector('[data-composer-card]')!.append(rail)
          send.disabled = true
          inputRef.current!.blur()
          dispatch(send, 'pointerdown')
          dispatch(send, 'mousedown')
          dispatch(send, 'click')
          window.setTimeout(() => {
            document.body.dataset.imageStopMarked = String(stop.dataset.mobileSendDraft === 'true')
            document.body.dataset.imageStopLabel = stop.getAttribute('aria-label') ?? ''
            document.body.dataset.imageStopGlyph = String(stop.querySelector('svg[data-mobile-send-glyph]') !== null)
            document.body.dataset.imageSendDisabledRestored = String(send.disabled)
            document.body.dataset.imageSendEntered = String(document.body.dataset.sendViaEnter === 'true')
            delete document.body.dataset.sendViaEnter
            rail.remove()
            window.setTimeout(() => {
              document.body.dataset.draftCleared = String(stop.dataset.mobileSendDraft === undefined && stop.querySelector('[data-mobile-send-glyph]') === null && send.dataset.mobileSendDraft === undefined)
              document.body.dataset.draftRestoredLabel = stop.getAttribute('aria-label') ?? ''
              // Model menu opens, then tapping the context meter must close it
              // even though the bridge swallows that trigger's mousedown.
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
      }, 40)
    }, 100)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('pointerdown', outsideMode)
      document.body.dataset.clickReachedStop = undefined
    }
  }, [])

  return <>
    <div ref={modeRef} data-mode-menu role="menu" data-open={modeOpen ? 'true' : undefined}>Read Only</div>
    <div data-composer-card>
      <div
        ref={inputRef}
        contentEditable
        suppressContentEditableWarning
        data-composer-input
        data-phase="plain"
        aria-label="message"
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          if (event.ctrlKey || event.metaKey) {
            document.body.dataset.sendViaSteer = 'true'
            return
          }
          if (inputRef.current?.dataset.mobileBusyPolicy === undefined) return
          document.body.dataset.sendViaEnter = 'true'
          // Official Lexical Enter handling cancels the DOM event after it has
          // resolved Queue/Steer and admitted the submission.
          event.preventDefault()
        }}
      />
      <button id="plus" type="button" aria-haspopup="listbox" aria-expanded="false">Plus</button>
      <button id="send" type="button" aria-label="发送消息">Send</button>
      {/* Compatibility probe: when a Host exposes an interruptible Stop beside
          the primary seat, the last localized Stop is the draft target. */}
      <button id="interrupt-stop" type="button" aria-label="停止生成" onClick={() => { document.body.dataset.interruptStopClicked = 'true' }}><svg width="16" height="16" aria-hidden="true" /></button>
      <button
        id="stop"
        type="button"
        aria-label="停止生成"
        onClick={() => { document.body.dataset.stopClicked = 'true' }}
        ><svg width="16" height="16" aria-hidden="true" />Stop</button>
      <button id="model-trigger" type="button" aria-haspopup="menu" aria-expanded="false" onClick={() => { document.body.dataset.modelMenuOpen = 'true' }}>Model</button>
      <div id="model-menu" role="menu" />
      {/* ContextMeter replica: panel keeps the official 8px-above-trigger
          anchor; the clamp only pulls an overflowing panel back on-screen. */}
      <span id="ctx-root" style={{ position: 'relative' }}>
        <button id="ctx-trigger" type="button" aria-haspopup="dialog" aria-expanded="true">ctx</button>
        <div id="ctx-panel" role="dialog" className="ctx-panel" />
      </span>
      <style>{`.ctx-panel { position: absolute; bottom: calc(100% + 8px); right: 0; box-sizing: border-box; width: 264px; height: 100px; display: block; }`}</style>
    </div>
    <ComposerAttach
      createDraftImages={() => []}
      inputActions={{
        addImages: () => true,
        submit: () => { document.body.dataset.sendViaSubmit = 'true' },
      }}
    />
  </>
}

createRoot(document.getElementById('root')!).render(<App />)
