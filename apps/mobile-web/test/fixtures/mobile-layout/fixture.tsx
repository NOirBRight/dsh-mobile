import React, { useMemo } from 'react'
import { createRoot } from 'react-dom/client'
import { MobileFrame } from '../../../../../packages/ui-layout-mobile/src/client/MobileFrame.tsx'
import { composerControlButton } from '../../../../../packages/ui-layout-mobile/src/client/composer-attach.ts'
import { CompactStatsLine } from '../../../../../packages/ui-layout-mobile/src/client/CompactStatsLine.tsx'
import { installTurnTailPresenter } from '../../../../../packages/ui-layout-mobile/src/client/turn-tail-presenter.ts'
import { installModelPickerPresenter } from '../../../../../packages/ui-layout-mobile/src/client/model-picker-presenter.ts'
import { installPermissionLabelPresenter } from '../../../../../packages/ui-layout-mobile/src/client/permission-label-presenter.ts'

const sessions = { current: 'session-a', byId: { 'session-a': { blank: false, displayTitle: 'Mobile UI Session' } } }
const useSessions = (select: (state: typeof sessions) => unknown) => select(sessions)
const statsProjections: Record<string, unknown> = {
  sessionStats: { turns: 4, steps: 8, llmMs: 20_000, toolMs: 0, ttftMs: 9_900, ttftSteps: 1, decodeMs: 1_000, decodeTokens: 68 },
  tokenUsage: { uncachedInputTokens: 24_000, cacheReadTokens: 96_000, cacheWriteTokens: 0, outputTokens: 9_200 },
}
let closeCount = 0

function FrameHarness({ id, width, laggyCodex = false, english = false, feedback = false }: { id: string; width: number; laggyCodex?: boolean; english?: boolean; feedback?: boolean }) {
  const panels = { drawerOpen: true, detailsOpen: laggyCodex }
  const useStore = (select: (state: typeof panels) => unknown) => select(panels)
  const actions = useMemo(() => ({
    toggleSidebar() {},
    closeDrawer() { closeCount += 1 },
    openDetails() {},
    closeDetails() {},
  }), [])
  const renderSlot = (name: string, owner: { width?: number }) => {
    if (name === 'sidebar') {
      return <div data-owner={id} data-owner-width={owner.width}>
        <div data-brand-row>
          <svg width="182" height="24" data-wordmark />
          <svg width="24" height="24" data-duplicate-fish />
          <svg width="16" height="16" data-panel-icon />
        </div>
        <button type="button" aria-label="New session" data-new-session>New session</button>
        <div role="treeitem" aria-selected="true" data-session-row={id}>Session A</div>
      </div>
    }
    if (name === 'details') {
      // The real Codex content is empty while collapsed; shell.overlay remains
      // stable, while these chrome nodes let the fixture inspect edge cleanup.
      if (laggyCodex) return <div data-codex-details-placeholder />
      return <div data-codex-details-placeholder><div className="dcs-root"><div className="dcs-tabbar" /></div></div>
    }
    if (name === 'shell.overlay') {
      return <div className="dcs-overlay"><button className="dcs-toggle" type="button"><svg width="16" height="16" /></button></div>
    }
    if (name === 'conversation') return <div style={{ '--dsh-composer-side-clearance': '16px' } as React.CSSProperties}>
      <header data-session-header>
        <div>
          <div><nav aria-label="会话层级">Old title</nav><div data-header-action>
            <span title="Current preset description" data-mode-label><svg width="14" height="14" />Standard mode</span>
            <div><button aria-haspopup="tree" aria-expanded="true"><span className="activitySlot" /><span data-subagent-count>15 个子代理</span><svg /></button><div role="tree" data-subagent-menu /></div>
            <div><button aria-expanded="true"><span data-state /><span data-job-count>1 background job running</span><svg /></button><ul aria-label="Background jobs" data-job-menu /></div>
          </div></div>
          <div data-header-utility><div data-utility-wrapper><button><span>Session log</span><svg /></button></div></div>
        </div>
        <div role="tablist"><button role="tab">对话</button><button role="tab">轨迹</button></div>
      </header>
      <div data-chat-scroll><div data-chat-flow>Conversation<div data-turn-tail><span className="fixture_timeEnd">23:41 <span className="fixture_runTimeDot">·</span> Ran for 15s <span className="fixture_runTimeDot">·</span> TTFT 1.2s <span className="fixture_runTimeDot">·</span> 72 tok/s</span></div></div></div>
      <div data-composer-card>
        <CompactStatsLine useProjection={key => statsProjections[key]} />
        <textarea aria-label="Prompt" />
        <div role="listbox"><button type="button" data-command-option>/plan</button></div>
        <div className="fixtureComposerToolbar">
          <div className="fixtureComposerTools"><button data-add-control>+</button><div><button data-plan-control aria-label="Workspace Write" aria-haspopup="menu"><span>Workspace Write</span></button></div></div>
          <div className="fixtureComposerTrailing"><div><button aria-haspopup="menu"><span>GPT-5.6 SOL</span><span>High</span></button></div><button aria-haspopup="dialog" data-context-control>272K</button><button data-send-control>↑</button></div>
        </div>
      </div>
      <div data-dsh-mobile-popup="rich" className="fixtureModelCard">
        <input aria-label="Search models" style={{ width: 400 }} />
        <div role="listbox"><div role="option"><span className="fixture_detail">Standard · 272K</span></div></div>
      </div>
      <section data-question-key={id} className="fixtureQuestionFrame">
        <div data-question-card className="fixtureQuestionCard">
          <div data-question-scroll>Question options</div>
          <footer className="fixtureQuestionFooter">
            <div className="fixtureQuestionPager"><button>‹</button><span>1 / 3</span><button>›</button></div>
            <div role="status">{feedback ? (english ? 'Please choose one option' : '请选择一个选项') : null}</div>
            <div className="fixtureQuestionActions"><button>{english ? 'Skip question' : '跳过本题'}</button><button>{english ? 'Submit answer' : '下一题'}</button></div>
          </footer>
        </div>
      </section>
    </div>
    return null
  }
  return <div id={id} style={{ width }}>
    <MobileFrame
      useStore={useStore as never}
      useSessions={useSessions as never}
      actions={actions as never}
      renderSlot={renderSlot as never}
      SessionProvider={(({ children }: { children?: React.ReactNode }) => children) as never}
    />
  </div>
}

function App() {
  React.useEffect(() => {
    const disposeTurnTail = installTurnTailPresenter()
    const disposeModelPicker = installModelPickerPresenter()
    const disposePermissionLabel = installPermissionLabelPresenter()
    const timer = window.setTimeout(() => {
      const laggySheet = document.querySelector<HTMLElement>('#laggy section[aria-label="详情面板"]')!
      document.body.dataset.laggySheetVisibility = getComputedStyle(laggySheet).visibility
      document.body.dataset.laggySheetTransform = getComputedStyle(laggySheet).transform
      const officialNotice = document.querySelector<HTMLElement>('#official [data-mobile-topbar-notice]')!
      officialNotice.hidden = false
      officialNotice.querySelector<HTMLElement>('[data-mobile-topbar-notice-text]')!.textContent = '连接暂时中断，正在重连…'
      const officialFrame = document.querySelector<HTMLElement>('#official [data-mobile-connection-notice-layer]')!.parentElement!
      const officialNoticeRect = officialNotice.getBoundingClientRect()
      const officialFrameRect = officialFrame.getBoundingClientRect()
      document.body.dataset.noticeCenterDelta = String(Math.round((officialNoticeRect.left + officialNoticeRect.width / 2) - (officialFrameRect.left + officialFrameRect.width / 2)))
      document.body.dataset.noticeInHeader = String(document.querySelector('#official header')?.contains(officialNotice) ?? false)
      document.body.dataset.noticeTitleVisible = String(!(document.querySelector<HTMLElement>('#official [data-mobile-session-title]')?.hidden ?? true))
      const official = document.querySelector<HTMLElement>('#official nav[aria-label="导航抽屉"]')!
      const constrained = document.querySelector<HTMLElement>('#constrained nav[aria-label="导航抽屉"]')!
      document.querySelector<HTMLElement>('[data-session-row="constrained"]')!.click()
      document.querySelector<HTMLElement>('#official [data-new-session]')!.click()
      document.body.dataset.closeCount = String(closeCount)
      document.body.dataset.officialDrawerWidth = String(official.getBoundingClientRect().width)
      document.body.dataset.officialOwnerWidth = document.querySelector<HTMLElement>('[data-owner="official"]')!.dataset.ownerWidth
      document.body.dataset.drawerWidth = String(constrained.getBoundingClientRect().width)
      document.body.dataset.ownerWidth = document.querySelector<HTMLElement>('[data-owner="constrained"]')!.dataset.ownerWidth
      document.body.dataset.topbarTitle = document.querySelector<HTMLElement>('header [title="Mobile UI Session"]')?.textContent ?? ''
      const header = document.querySelector<HTMLElement>('#official [data-session-header]')!
      const tablist = header.querySelector<HTMLElement>('[role="tablist"]')!
      const action = header.querySelector<HTMLElement>('[data-header-action]')!
      const utility = header.querySelector<HTMLElement>('[data-header-utility]')!
      const centers = [tablist, action, utility].map((element) => {
        const rect = element.getBoundingClientRect()
        return Math.round(rect.top + rect.height / 2)
      })
      document.body.dataset.headerTops = centers.join(',')
      document.body.dataset.headerSingleRow = String(Math.max(...centers) - Math.min(...centers) < 6)
      const breadcrumb = header.querySelector<HTMLElement>('nav')!
      document.body.dataset.crumbHidden = getComputedStyle(breadcrumb).display
      const childCrumb = document.createElement('button')
      childCrumb.type = 'button'
      childCrumb.setAttribute('aria-haspopup', 'tree')
      childCrumb.setAttribute('aria-label', '切换子代理：Child')
      childCrumb.textContent = 'Child'
      breadcrumb.append(document.createTextNode(' / '), childCrumb)
      const childStyle = getComputedStyle(breadcrumb)
      document.body.dataset.childCrumbDisplay = childStyle.display
      document.body.dataset.childCrumbPosition = childStyle.position
      document.body.dataset.childCrumbTop = String(Math.round(breadcrumb.getBoundingClientRect().top))
      document.body.dataset.fishHidden = getComputedStyle(document.querySelector<HTMLElement>('#official [data-duplicate-fish]')!).display
      document.body.dataset.panelVisible = getComputedStyle(document.querySelector<HTMLElement>('#official [data-panel-icon]')!).display
      const codexFrame = document.querySelector<HTMLElement>('#official [data-drawer-open]')!
      const codexFrameRect = codexFrame.getBoundingClientRect()
      const codexSheet = document.querySelector<HTMLElement>('#official section[aria-label="详情面板"]')!
      const codexRect = codexSheet.getBoundingClientRect()
      const codexToggle = document.querySelector<HTMLElement>('#official .dcs-toggle')!
      const codexIcon = codexToggle.querySelector<SVGElement>('svg')!
      const menuButton = document.querySelector<HTMLElement>('#official button[aria-label="打开导航菜单"]')!
      const codexRoot = document.querySelector<HTMLElement>('#official .dcs-root')!
      const codexTabbar = document.querySelector<HTMLElement>('#official .dcs-tabbar')!
      document.body.dataset.codexSheetBg = getComputedStyle(codexSheet).backgroundColor
      document.body.dataset.codexSheetPadBottom = getComputedStyle(codexSheet).paddingBottom
      // A tap must not leave a stuck hover block behind the Codex toggle; hover
      // chrome belongs to hover-capable pointers only (match the hamburger).
      let ungatedHover = false
      const scanRules = (rules: CSSRuleList, media: string[]): void => {
        for (const rule of Array.from(rules)) {
          if (rule instanceof CSSMediaRule) {
            scanRules(rule.cssRules, [...media, rule.media.mediaText])
            continue
          }
          if (rule.cssText.includes('.dcs-toggle') && rule.cssText.includes(':hover')
            && !media.some(text => text.includes('hover: hover'))) {
            ungatedHover = true
          }
        }
      }
      for (const sheet of Array.from(document.styleSheets)) {
        try { scanRules(sheet.cssRules, []) } catch { /* cross-sheet guard */ }
      }
      document.body.dataset.toggleHoverUngated = String(ungatedHover)
      document.body.dataset.codexRootBg = getComputedStyle(codexRoot).backgroundColor
      document.body.dataset.codexClosedLeft = String(Math.round(codexRect.left - codexFrameRect.left))
      document.body.dataset.codexClosedTop = String(Math.round(codexRect.top - codexFrameRect.top))
      document.body.dataset.codexWidth = String(Math.round(codexRect.width))
      document.body.dataset.codexToggleWidth = String(Math.round(codexToggle.getBoundingClientRect().width))
      document.body.dataset.codexToggleHeight = String(Math.round(codexToggle.getBoundingClientRect().height))
      document.body.dataset.codexIconWidth = String(Math.round(codexIcon.getBoundingClientRect().width))
      document.body.dataset.codexIconHeight = String(Math.round(codexIcon.getBoundingClientRect().height))
      document.body.dataset.codexIconTransform = getComputedStyle(codexIcon).transform
      const menuRect = menuButton.getBoundingClientRect()
      const toggleRect = codexToggle.getBoundingClientRect()
      document.body.dataset.codexCenterDelta = String(Math.round((toggleRect.top + toggleRect.height / 2) - (menuRect.top + menuRect.height / 2)))
      document.body.dataset.codexRootBorderBottom = getComputedStyle(codexRoot).borderBottomWidth
      document.body.dataset.codexRootBorderLeft = getComputedStyle(codexRoot).borderLeftWidth
      document.body.dataset.codexTabbarBorderBottom = getComputedStyle(codexTabbar).borderBottomWidth
      const headerRect = header.getBoundingClientRect()
      const tabRect = tablist.getBoundingClientRect()
      const actionRect = action.getBoundingClientRect()
      const utilityRect = utility.getBoundingClientRect()
      const preset = header.querySelector<HTMLElement>('[data-mode-label]')!
      const subagentButton = header.querySelector<HTMLElement>('[data-subagent-count]')!.closest('button')!
      const jobButton = header.querySelector<HTMLElement>('[data-job-count]')!.closest('button')!
      const presetRect = preset.getBoundingClientRect()
      const subagentRect = subagentButton.getBoundingClientRect()
      const jobRect = jobButton.getBoundingClientRect()
      document.body.dataset.headerWidths = [headerRect.left, tabRect.right, actionRect.left, actionRect.right, utilityRect.left, utilityRect.right, headerRect.right].map(Math.round).join(',')
      document.body.dataset.headerFits = String(
        tabRect.left >= headerRect.left - 1
        && tabRect.right <= actionRect.left + 1
        && actionRect.right <= utilityRect.left + 1
        && utilityRect.right <= headerRect.right + 1,
      )
      document.body.dataset.headerLeftInset = String(Math.round(tabRect.left - headerRect.left))
      document.body.dataset.headerRightInset = String(Math.round(headerRect.right - utilityRect.right))
      document.body.dataset.modeSubagentGap = String(Math.round(subagentRect.left - presetRect.right))
      document.body.dataset.subagentJobGap = String(Math.round(jobRect.left - subagentRect.right))
      document.body.dataset.actionJustify = getComputedStyle(action).justifyContent
      document.body.dataset.actionGap = getComputedStyle(action).gap
      const subagentCount = header.querySelector<HTMLElement>('[data-subagent-count]')!
      const jobCount = header.querySelector<HTMLElement>('[data-job-count]')!
      document.documentElement.lang = 'en'
      document.body.dataset.subagentCopyEn = getComputedStyle(subagentCount, '::after').content
      document.body.dataset.jobCopyEn = getComputedStyle(jobCount, '::after').content
      document.body.dataset.modeText = preset.textContent ?? ''
      document.body.dataset.modeFontSize = getComputedStyle(preset).fontSize
      document.body.dataset.modeMaxWidth = getComputedStyle(preset).maxWidth
      document.body.dataset.traceCopyEn = getComputedStyle(tablist.querySelectorAll<HTMLElement>('[role="tab"]')[1]!, '::after').content
      document.documentElement.lang = 'zh-CN'
      document.body.dataset.subagentCopyZh = getComputedStyle(subagentCount, '::after').content
      document.body.dataset.jobCopyZh = getComputedStyle(jobCount, '::after').content
      document.body.dataset.subagentCopyDisplay = getComputedStyle(subagentCount, '::after').display
      document.body.dataset.subagentCopyLineHeight = getComputedStyle(subagentCount, '::after').lineHeight
      document.body.dataset.jobCopyDisplay = getComputedStyle(jobCount, '::after').display
      document.body.dataset.jobCopyLineHeight = getComputedStyle(jobCount, '::after').lineHeight
      document.body.dataset.logCopy = getComputedStyle(header.querySelector<HTMLElement>('[data-header-utility] span')!, '::after').content
      document.body.dataset.subagentMenuPosition = getComputedStyle(header.querySelector<HTMLElement>('[data-subagent-menu]')!).position
      document.body.dataset.jobMenuPosition = getComputedStyle(header.querySelector<HTMLElement>('[data-job-menu]')!).position
      document.body.dataset.chatPadding = getComputedStyle(document.querySelector<HTMLElement>('#official [data-chat-scroll]')!).paddingLeft
      const commandOption = document.querySelector<HTMLElement>('#phone320 [data-command-option]')!
      document.body.dataset.commandOptionOwned = String(composerControlButton(commandOption) === null)
      const composerCard = document.querySelector<HTMLElement>('#phone320 [data-composer-card]')!
      const statsLine = composerCard.querySelector<HTMLElement>('span')!
      const statsRect = statsLine.getBoundingClientRect()
      const composerRect = composerCard.getBoundingClientRect()
      document.body.dataset.compactStatsText = statsLine.textContent ?? ''
      document.body.dataset.compactStatsFits = String(statsRect.left >= composerRect.left - 1 && statsRect.right <= composerRect.right + 1)
      const toolbar = document.querySelector<HTMLElement>('#phone320 .fixtureComposerToolbar')!
      const addControl = toolbar.querySelector<HTMLElement>('[data-add-control]')!
      const planControl = toolbar.querySelector<HTMLElement>('[data-plan-control]')!
      const modelControl = toolbar.querySelector<HTMLElement>('.fixtureComposerTrailing button[aria-haspopup="menu"]')!
      const contextControl = toolbar.querySelector<HTMLElement>('[data-context-control]')!
      const addRect = addControl.getBoundingClientRect()
      const planRect = planControl.getBoundingClientRect()
      const modelRect = modelControl.getBoundingClientRect()
      const contextRect = contextControl.getBoundingClientRect()
      document.body.dataset.permissionCompactLabel = planControl.querySelector<HTMLElement>('span')?.dataset.mobilePermissionLabel ?? ''
      document.body.dataset.planControlGap = String(Math.round(planRect.left - addRect.right))
      document.body.dataset.modelControlWidth = String(Math.round(modelRect.width))
      document.body.dataset.modelContextGap = String(Math.round(contextRect.left - modelRect.right))
      document.body.dataset.composerControlsFit = String(planRect.right <= modelRect.left && modelRect.right <= contextRect.left)
      document.body.dataset.turnTailSummary = document.querySelector<HTMLElement>('#phone320 [data-mobile-turn-summary]')?.dataset.mobileTurnSummary ?? ''
      const modelCard = document.querySelector<HTMLElement>('#phone320 .fixtureModelCard')!
      const modelSearch = modelCard.querySelector<HTMLElement>('input')!
      const modelCardRect = modelCard.getBoundingClientRect()
      const modelSearchRect = modelSearch.getBoundingClientRect()
      document.body.dataset.modelSearchFits = String(modelSearchRect.left >= modelCardRect.left && modelSearchRect.right <= modelCardRect.right)
      document.body.dataset.modelDetail = modelCard.querySelector<HTMLElement>('[data-mobile-model-detail]')?.dataset.mobileModelDetail ?? ''
      const matrixIds = ['phone320', 'official', 'phone390', 'phone412']
      const matrixResults = matrixIds.map(id => {
        const questionFooter = document.querySelector<HTMLElement>('#' + id + ' .fixtureQuestionFooter')!
        const footerRect = questionFooter.getBoundingClientRect()
        const questionParts = Array.from(questionFooter.children)
          .filter(node => (node as HTMLElement).getClientRects().length > 0)
          .map(node => (node as HTMLElement).getBoundingClientRect())
        const questionButtons = Array.from(questionFooter.querySelectorAll<HTMLElement>('.fixtureQuestionActions button'))
        const questionFrame = questionFooter.closest<HTMLElement>('[data-question-key]')!
        return questionParts.every(rect => rect.left >= footerRect.left - 1 && rect.right <= footerRect.right + 1)
          && Math.abs(questionButtons[0]!.getBoundingClientRect().width - questionButtons[1]!.getBoundingClientRect().width) < 1
          && questionButtons.every(button => button.getBoundingClientRect().height <= 42)
          && Number.parseFloat(getComputedStyle(questionFrame).paddingLeft) <= 8
      })
      document.body.dataset.questionFooterFits = String(matrixResults.every(Boolean))
      document.body.dataset.questionActionEqual = String(matrixResults.every(Boolean))
      document.body.dataset.questionMatrix = matrixIds.map((id, index) => id + ':' + matrixResults[index]).join(',')
      document.body.dataset.ready = 'true'
    }, 100)
    return () => { window.clearTimeout(timer); disposeTurnTail(); disposeModelPicker(); disposePermissionLabel() }
  }, [])
  return <>
    <style>{`:root { --dsw-alias-bg-base: #ffffff; --dsw-alias-bg-layer-1: #f3f4f6; }
      .dcs-overlay { position: absolute; inset: 0; } .dcs-toggle { position: absolute; top: 8px; right: 8px; width: 32px; height: 32px; } .dcs-root { border-left: 1px solid; border-bottom: 1px solid; background: var(--dsw-alias-bg-layer-1); } .dcs-tabbar { border-bottom: 1px solid; }
      .fixtureComposerToolbar, .fixtureComposerTools, .fixtureComposerTrailing { display: flex; align-items: center; } .fixtureComposerToolbar { box-sizing: border-box; justify-content: space-between; width: 100%; } .fixtureComposerTools, .fixtureComposerTrailing { min-width: 0; } .fixtureComposerToolbar button { min-width: 28px; height: 28px; } .fixtureModelCard { box-sizing: border-box; display: flex; flex-direction: column; width: 260px; padding: 4px; } .fixtureQuestionFrame { box-sizing: border-box; width: 100%; padding: 6px 32px 10px; } [data-question-card] { width: 100%; } .fixtureQuestionFooter { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; padding: 0 10px; } .fixtureQuestionPager, .fixtureQuestionActions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; } .fixtureQuestionFooter button { min-height: 40px; padding: 0 16px; white-space: nowrap; } .fixtureQuestionFooter [role=status] { flex: 1; }`}</style>
    <FrameHarness id="official" width={360} />
    <FrameHarness id="constrained" width={240} />
    <FrameHarness id="phone320" width={320} english feedback />
    <FrameHarness id="phone390" width={390} english feedback />
    <FrameHarness id="phone412" width={412} feedback />
    {/* Host applies the expand intent after the tap; until Codex mounts its
        content the open drawer must stay parked instead of sliding out blank. */}
    <FrameHarness id="laggy" width={360} laggyCodex />
  </>
}

createRoot(document.getElementById('root')!).render(<App />)
