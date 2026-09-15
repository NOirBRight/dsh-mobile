import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ComposerAttach } from '../../../../../packages/ui-layout-mobile/src/client/ComposerAttach.tsx'

function dispatch(target: HTMLElement, type: string): void {
  target.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }))
}

function useIdleSession<T>(sel: (s: { readonly running: boolean; readonly subagent: null }) => T): T {
  return sel({ running: false, subagent: null })
}

function OfficialSlashMenu({ locale }: { locale: 'zh' | 'en' }) {
  const file = locale === 'zh' ? '文件' : 'File'
  const goal = locale === 'zh' ? '目标' : 'Goal'
  return (
    <div data-trigger-menu>
      <div role="listbox" aria-label={locale === 'zh' ? '触发候选建议' : 'Trigger suggestions'}>
        <div role="presentation">{locale === 'zh' ? '添加' : 'Add'}</div>
        <button type="button" role="option" data-command="file">
          <span aria-hidden />
          <span>{file}</span>
          {locale === 'zh' ? <span>file</span> : null}
        </button>
        <button type="button" role="option" data-command="goal">
          <span aria-hidden />
          <span>{goal}</span>
          {locale === 'zh' ? <span>goal</span> : null}
        </button>
      </div>
    </div>
  )
}

function ComposerCard({
  id,
  locale,
  attach,
}: {
  id: string
  locale: 'zh' | 'en'
  attach: boolean
}) {
  const [slashOpen, setSlashOpen] = useState(false)
  const plusLabel = locale === 'zh' ? '添加文件或调用指令' : 'Add files or run commands'
  return (
    <div data-composer-card id={id}>
      <button
        id={id + '-plus'}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={slashOpen ? 'true' : 'false'}
        aria-label={plusLabel}
        onClick={() => { setSlashOpen(true) }}
      >Plus</button>
      {slashOpen && <OfficialSlashMenu locale={locale} />}
      {attach && (
        <ComposerAttach
          useSession={useIdleSession}
          inputActions={{ addImages: () => true }}
          createDraftImages={() => []}
        />
      )}
    </div>
  )
}

function captureRow(cardId: string, command: string): { hidden: string; display: string; label: string } {
  const option = document.querySelector<HTMLElement>('#' + cardId + ' [data-command="' + command + '"]')
  if (option === null) return { hidden: 'missing', display: '', label: '' }
  return {
    hidden: option.getAttribute('data-mobile-file-row-hidden') ?? '',
    display: getComputedStyle(option).display,
    label: option.textContent?.replace(/\s+/g, ' ').trim() ?? '',
  }
}

function menuLabels(): string {
  return Array.from(document.querySelectorAll('[role="menu"] [role="menuitem"]'))
    .map(el => el.textContent?.replace(/\s+/g, ' ').trim() ?? '')
    .join('|')
}

function App() {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const plusZh = document.querySelector<HTMLElement>('#narrow-zh-plus')!
      dispatch(plusZh, 'pointerdown')
      dispatch(plusZh, 'click')
      window.setTimeout(() => {
        document.body.dataset.zhAttachMenu = menuLabels()
        document.body.dataset.zhPlusLabel = plusZh.getAttribute('aria-label') ?? ''
        const commandZh = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
          .find(el => (el.textContent ?? '').includes('命令'))
        commandZh?.click()
        window.setTimeout(() => {
          const zhFile = captureRow('narrow-zh', 'file')
          const zhGoal = captureRow('narrow-zh', 'goal')
          document.body.dataset.zhFileHidden = zhFile.hidden
          document.body.dataset.zhFileDisplay = zhFile.display
          document.body.dataset.zhFileLabel = zhFile.label
          document.body.dataset.zhGoalHidden = zhGoal.hidden
          document.body.dataset.zhGoalDisplay = zhGoal.display
          const plusEn = document.querySelector<HTMLElement>('#narrow-en-plus')!
          dispatch(plusEn, 'pointerdown')
          dispatch(plusEn, 'click')
          window.setTimeout(() => {
            document.body.dataset.enAttachMenu = menuLabels()
            document.body.dataset.enPlusLabel = plusEn.getAttribute('aria-label') ?? ''
            const commandEn = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
              .find(el => (el.textContent ?? '').includes('命令'))
            commandEn?.click()
            window.setTimeout(() => {
              const enFile = captureRow('narrow-en', 'file')
              const enGoal = captureRow('narrow-en', 'goal')
              document.body.dataset.enFileHidden = enFile.hidden
              document.body.dataset.enFileDisplay = enFile.display
              document.body.dataset.enFileLabel = enFile.label
              document.body.dataset.enGoalHidden = enGoal.hidden
              document.body.dataset.enGoalDisplay = enGoal.display
              const plusDesk = document.querySelector<HTMLElement>('#desktop-en-plus')!
              dispatch(plusDesk, 'pointerdown')
              dispatch(plusDesk, 'mousedown')
              dispatch(plusDesk, 'click')
              window.setTimeout(() => {
                const deskFile = captureRow('desktop-en', 'file')
                const deskGoal = captureRow('desktop-en', 'goal')
                document.body.dataset.deskFileHidden = deskFile.hidden
                document.body.dataset.deskFileDisplay = deskFile.display
                document.body.dataset.deskFileLabel = deskFile.label
                document.body.dataset.deskGoalHidden = deskGoal.hidden
                document.body.dataset.ready = 'true'
              }, 80)
            }, 80)
          }, 40)
        }, 80)
      }, 40)
    }, 100)
    return () => { window.clearTimeout(timer) }
  }, [])

  return <>
    <ComposerCard id="narrow-zh" locale="zh" attach />
    <ComposerCard id="narrow-en" locale="en" attach />
    <ComposerCard id="desktop-en" locale="en" attach={false} />
  </>
}

createRoot(document.getElementById('root')!).render(<App />)
