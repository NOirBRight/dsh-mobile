import React, { useMemo } from 'react'
import { createRoot } from 'react-dom/client'
import { MobileFrame } from '../../../../../packages/ui-layout-mobile/src/client/MobileFrame.tsx'

const sessions = { current: 'session-a', byId: { 'session-a': { blank: false, displayTitle: 'Mobile UI Session' } } }
const useSessions = (select: (state: typeof sessions) => unknown) => select(sessions)
let closeCount = 0

function FrameHarness({ id, width, laggyCodex = false }: { id: string; width: number; laggyCodex?: boolean }) {
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
      <div data-chat-scroll><div data-chat-flow>Conversation</div></div>
    </div>
    return null
  }
  return <div id={id} style={{ width }}>
    <MobileFrame
      useStore={useStore as never}
      useSessions={useSessions as never}
      actions={actions as never}
      renderSlot={renderSlot as never}
    />
  </div>
}

function App() {
  React.useEffect(() => {
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
      document.body.dataset.logCopy = getComputedStyle(header.querySelector<HTMLElement>('[data-header-utility] span')!, '::after').content
      document.body.dataset.subagentMenuPosition = getComputedStyle(header.querySelector<HTMLElement>('[data-subagent-menu]')!).position
      document.body.dataset.jobMenuPosition = getComputedStyle(header.querySelector<HTMLElement>('[data-job-menu]')!).position
      document.body.dataset.chatPadding = getComputedStyle(document.querySelector<HTMLElement>('#official [data-chat-scroll]')!).paddingLeft
      document.body.dataset.ready = 'true'
    }, 100)
    return () => { window.clearTimeout(timer) }
  }, [])
  return <>
    <style>{`:root { --dsw-alias-bg-base: #ffffff; --dsw-alias-bg-layer-1: #f3f4f6; }
      .dcs-overlay { position: absolute; inset: 0; } .dcs-toggle { position: absolute; top: 8px; right: 8px; width: 32px; height: 32px; } .dcs-root { border-left: 1px solid; border-bottom: 1px solid; background: var(--dsw-alias-bg-layer-1); } .dcs-tabbar { border-bottom: 1px solid; }`}</style>
    <FrameHarness id="official" width={360} />
    <FrameHarness id="constrained" width={240} />
    {/* Host applies the expand intent after the tap; until Codex mounts its
        content the open drawer must stay parked instead of sliding out blank. */}
    <FrameHarness id="laggy" width={360} laggyCodex />
  </>
}

createRoot(document.getElementById('root')!).render(<App />)
