import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ComposerAttach } from '../../../../../packages/ui-layout-mobile/src/client/ComposerAttach.tsx'
import { installSlashMenuIconPresenter } from '../../../../../packages/ui-layout-mobile/src/client/skill-menu-icon.ts'

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
          <span aria-hidden><svg width="16" height="16" /></span>
          <span>{file}</span>
          {locale === 'zh' ? <span>file</span> : null}
        </button>
        <button type="button" role="option" data-command="goal">
          <span aria-hidden><svg width="16" height="16" /></span>
          <span>{goal}</span>
          {locale === 'zh' ? <span>goal</span> : null}
        </button>
        <button type="button" role="option" data-command="ponytail">
          <span>ponytail</span>
        </button>
        <button type="button" role="option" id={locale === 'zh' ? 'dsh-slash-option-skill-0' : 'dsh-slash-option-skill-1'} data-command="skill">
          <span>ask-matt</span>
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
          inputActions={{}}
        />
      )}
    </div>
  )
}

function captureRow(cardId: string, command: string): { hidden: string; display: string; label: string; cube: string } {
  const option = document.querySelector<HTMLElement>('#' + cardId + ' [data-command="' + command + '"]')
  if (option === null) return { hidden: 'missing', display: '', label: '', cube: '' }
  return {
    hidden: option.getAttribute('data-mobile-file-row-hidden') ?? '',
    display: getComputedStyle(option).display,
    label: option.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    cube: option.querySelector('[data-mobile-menu-icon]') === null ? '' : 'cube',
  }
}

function listboxLabels(cardId: string): string {
  return Array.from(document.querySelectorAll('#' + cardId + ' [role="listbox"] [role="option"]'))
    .map(el => el.textContent?.replace(/\s+/g, ' ').trim() ?? '')
    .join('|')
}

function overlayMenuLabels(): string {
  return Array.from(document.querySelectorAll('[role="menu"] [role="menuitem"]'))
    .map(el => el.textContent?.replace(/\s+/g, ' ').trim() ?? '')
    .join('|')
}

function App() {
  useEffect(() => installSlashMenuIconPresenter(), [])
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const plusZh = document.querySelector<HTMLElement>('#narrow-zh-plus')!
      dispatch(plusZh, 'mousedown')
      dispatch(plusZh, 'click')
      window.setTimeout(() => {
        document.body.dataset.zhAttachMenu = overlayMenuLabels()
        document.body.dataset.zhPlusLabel = plusZh.getAttribute('aria-label') ?? ''
        document.body.dataset.zhListbox = listboxLabels('narrow-zh')
        const zhFile = captureRow('narrow-zh', 'file')
        const zhGoal = captureRow('narrow-zh', 'goal')
        document.body.dataset.zhFileHidden = zhFile.hidden
        document.body.dataset.zhFileDisplay = zhFile.display
        document.body.dataset.zhFileLabel = zhFile.label
        document.body.dataset.zhGoalHidden = zhGoal.hidden
        document.body.dataset.zhGoalDisplay = zhGoal.display
        const plusEn = document.querySelector<HTMLElement>('#narrow-en-plus')!
        dispatch(plusEn, 'mousedown')
        dispatch(plusEn, 'click')
        window.setTimeout(() => {
          document.body.dataset.enAttachMenu = overlayMenuLabels()
          document.body.dataset.enPlusLabel = plusEn.getAttribute('aria-label') ?? ''
          document.body.dataset.enListbox = listboxLabels('narrow-en')
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
            document.body.dataset.deskListbox = listboxLabels('desktop-en')
            document.body.dataset.zhFileCube = captureRow('narrow-zh', 'file').cube
            document.body.dataset.zhPonytailCube = captureRow('narrow-zh', 'ponytail').cube
            document.body.dataset.zhSkillCube = captureRow('narrow-zh', 'skill').cube
            document.body.dataset.ready = 'true'
          }, 80)
        }, 80)
      }, 80)
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
