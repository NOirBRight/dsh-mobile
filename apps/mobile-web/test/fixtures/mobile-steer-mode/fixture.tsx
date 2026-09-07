import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ComposerAttach } from '../../../../../packages/ui-layout-mobile/src/client/ComposerAttach.tsx'

function dispatch(target: HTMLElement, type: string): void {
  target.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }))
}

interface SessionFace {
  readonly running: boolean
  readonly subagent: unknown | null
}

function useChildSession<T>(sel: (s: SessionFace) => T): T {
  return sel({ running: true, subagent: { address: { mode: 'continuable' } } })
}

function App() {
  const mainInputRef = useRef<HTMLDivElement>(null)
  const childInputRef = useRef<HTMLDivElement>(null)
  const [mainRunning, setMainRunning] = useState(true)
  const [pref, setPref] = useState('steer')
  const [childAttached, setChildAttached] = useState(true)
  const live = useRef({ running: true, pref: 'steer' })
  live.current = { running: mainRunning, pref }
  const useMainSession = useCallback(<T,>(sel: (s: SessionFace) => T): T => (
    sel({ running: mainRunning, subagent: null })
  ), [mainRunning])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const mainSend = document.querySelector<HTMLElement>('#main-send')!
      dispatch(mainSend, 'pointerdown')
      dispatch(mainSend, 'mousedown')
      dispatch(mainSend, 'click')
      window.setTimeout(() => {
        document.body.dataset.modeSteer = document.body.dataset.mainMode ?? 'unset'
        document.body.dataset.textSteer = document.body.dataset.mainText ?? 'unset'
        document.body.dataset.submitSteer = document.body.dataset.mainSubmit ?? 'false'
        document.body.dataset.mainHiddenSteer = mainSend.getAttribute('data-mobile-secondary-hidden') ?? ''
        setPref('queue')
        window.setTimeout(() => {
          dispatch(mainSend, 'pointerdown')
          dispatch(mainSend, 'mousedown')
          dispatch(mainSend, 'click')
          window.setTimeout(() => {
            document.body.dataset.modeQueue = document.body.dataset.mainMode ?? 'unset'
            setMainRunning(false)
            window.setTimeout(() => {
              delete document.body.dataset.mainMode
              dispatch(mainSend, 'pointerdown')
              dispatch(mainSend, 'mousedown')
              dispatch(mainSend, 'click')
              window.setTimeout(() => {
                document.body.dataset.submitIdle = document.body.dataset.mainSubmit ?? 'false'
                document.body.dataset.modeIdle = document.body.dataset.mainMode ?? 'unset'
                const mainCount = document.body.dataset.mainEnterCount ?? '0'
                const childSend = document.querySelector<HTMLElement>('#child-send')! as HTMLButtonElement
                const childStop = document.querySelector<HTMLElement>('#child-stop')!
                document.body.dataset.childSendHidden = childSend.getAttribute('data-mobile-secondary-hidden') ?? ''
                childInputRef.current!.textContent = 'child follow-up'
                delete document.body.dataset.childEnter
                dispatch(childSend, 'pointerdown')
                dispatch(childSend, 'mousedown')
                dispatch(childSend, 'click')
                window.setTimeout(() => {
                  document.body.dataset.childEntered = document.body.dataset.childEnter ?? 'false'
                  document.body.dataset.childEnterText = document.body.dataset.childEnterText ?? ''
                  document.body.dataset.mainCountAfterChild = (document.body.dataset.mainEnterCount ?? '0') + ':' + mainCount
                  setChildAttached(false)
                  window.setTimeout(() => {
                    document.body.dataset.childHiddenAfterUnmount = childSend.getAttribute('data-mobile-secondary-hidden') ?? ''
                    document.body.dataset.childInlineAfterUnmount = childSend.style.display
                    document.body.dataset.ready = 'true'
                  }, 0)
                }, 0)
              }, 0)
            }, 0)
          }, 0)
        }, 0)
      }, 0)
    }, 100)
    return () => { window.clearTimeout(timer) }
  }, [])

  return <>
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
          const { running, pref } = live.current
          document.body.dataset.mainEnterCount = String(Number(document.body.dataset.mainEnterCount ?? '0') + 1)
          if (!running) return
          document.body.dataset.mainMode = pref
          document.body.dataset.mainText = mainInputRef.current?.textContent ?? ''
          event.preventDefault()
        }}
      >main follow-up</div>
      <button id="main-send" type="button" aria-label="Send message">Send</button>
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
      <button id="child-stop" type="button" aria-label="Stop"><svg width="16" height="16" aria-hidden="true" /></button>
      {childAttached && (
        <ComposerAttach
          useSession={useChildSession}
          inputActions={{ addImages: () => true }}
          createDraftImages={() => []}
        />
      )}
    </div>
  </>
}

createRoot(document.getElementById('root')!).render(<App />)
