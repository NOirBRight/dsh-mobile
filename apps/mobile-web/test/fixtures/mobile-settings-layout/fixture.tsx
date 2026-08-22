import React, { useEffect, useMemo } from 'react'
import { createRoot } from 'react-dom/client'
import { MobileFrame } from '../../../../../packages/ui-layout-mobile/src/client/MobileFrame.tsx'

const sessions = { current: 'session-a', byId: { 'session-a': { blank: false, displayTitle: 'Settings Session' } } }
const useSessions = (select: (state: typeof sessions) => unknown) => select(sessions)

function App() {
  const panels = { drawerOpen: true, detailsOpen: false }
  const useStore = (select: (state: typeof panels) => unknown) => select(panels)
  const actions = useMemo(() => ({
    toggleSidebar() {},
    closeDrawer() {},
    openDetails() {},
    closeDetails() {},
  }), [])
  const renderSlot = (name: string) => {
    if (name === 'sidebar') return <div data-official-sidebar-root>
      <div data-official-logo-row>
        <button type="button" aria-label="收起侧边栏" data-sidebar-toggle>
          <svg width="16" height="16" aria-hidden="true" />
        </button>
      </div>
      <div role="dialog" aria-modal="true" data-settings-panel>
        <nav data-settings-nav>
          <div data-settings-title>设置</div>
          <div data-settings-nav-list>
            {['通用设置', '模型', 'LLM 供应商', '插件', '用量', 'Agent 预设', '插件市场'].map((label, index) => (
              <button key={label} type="button" data-settings-nav-item aria-current={index === 0 ? 'true' : undefined}>{label}</button>
            ))}
          </div>
        </nav>
        <div data-settings-content>
          <div data-settings-header><button type="button" aria-label="关闭">×</button></div>
          <div data-settings-options>
            <div>
              <section data-settings-section>
                <div>
                  <div data-provider-card>Cursor provider card</div>
                  <div data-settings-theme-group>
                    <div data-settings-theme-row>
                      <button type="button" aria-pressed="true"><svg width="16" height="16" aria-hidden="true" /><span data-theme-label>浅色</span></button>
                      <button type="button" aria-pressed="false"><svg width="16" height="16" aria-hidden="true" /><span data-theme-label>深色</span></button>
                      <button type="button" aria-pressed="false"><svg width="16" height="16" aria-hidden="true" /><span data-theme-label>跟随系统</span></button>
                    </div>
                  </div>
                  <div data-settings-enter-row>
                    <div>
                      <div>繁忙时 Enter 键行为</div>
                      <div>仅在智能体运行时生效；Cmd/Ctrl+Enter 使用另一行为</div>
                    </div>
                    <span><button type="button">插话发送</button></span>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
    if (name === 'shell.overlay') return <div className="dcs-overlay">
      <button type="button" className="dcs-toggle" data-codex-toggle aria-label="显示侧栏">
        <svg width="16" height="16" aria-hidden="true" />
      </button>
      <div className="dcs-col-handle" data-codex-handle />
    </div>
    if (name === 'conversation') return <div>Conversation</div>
    return null
  }
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const panel = document.querySelector<HTMLElement>('[data-settings-panel]')!
      const overlay = panel.parentElement!
      const nav = document.querySelector<HTMLElement>('[data-settings-nav]')!
      const list = document.querySelector<HTMLElement>('[data-settings-nav-list]')!
      const content = document.querySelector<HTMLElement>('[data-settings-content]')!
      const options = document.querySelector<HTMLElement>('[data-settings-options]')!
      const section = document.querySelector<HTMLElement>('[data-settings-section]')!
      const codexToggle = document.querySelector<HTMLElement>('[data-codex-toggle]')!
      const codexHandle = document.querySelector<HTMLElement>('[data-codex-handle]')!
      document.body.dataset.codexToggleVisibility = getComputedStyle(codexToggle).visibility
      document.body.dataset.codexTogglePointerEvents = getComputedStyle(codexToggle).pointerEvents
      document.body.dataset.codexHandleVisibility = getComputedStyle(codexHandle).visibility
      document.body.dataset.viewportWidth = String(window.innerWidth)
      document.body.dataset.viewportHeight = String(window.innerHeight)
      document.body.dataset.overlayPaddingTop = getComputedStyle(overlay).paddingTop
      document.body.dataset.overlayPaddingBottom = getComputedStyle(overlay).paddingBottom
      document.body.dataset.overlayClass = String(overlay.className)
      document.body.dataset.overlayParentClass = String(overlay.parentElement?.className)
      document.body.dataset.panelTop = String(Math.round(panel.getBoundingClientRect().top))
      document.body.dataset.panelNavTop = String(Math.round(nav.getBoundingClientRect().top - panel.getBoundingClientRect().top))
      document.body.dataset.panelWidth = String(Math.round(panel.getBoundingClientRect().width))
      document.body.dataset.panelHeight = String(Math.round(panel.getBoundingClientRect().height))
      document.body.dataset.navWidth = String(Math.round(nav.getBoundingClientRect().width))
      document.body.dataset.navListDirection = getComputedStyle(list).flexDirection
      document.body.dataset.navListOverflow = getComputedStyle(list).overflowX
      document.body.dataset.contentWidth = String(Math.round(content.getBoundingClientRect().width))
      document.body.dataset.optionsWidth = String(Math.round(options.getBoundingClientRect().width))
      const optionStyle = getComputedStyle(options)
      const optionsContentWidth = options.clientWidth - Number.parseFloat(optionStyle.paddingLeft) - Number.parseFloat(optionStyle.paddingRight)
      document.body.dataset.optionsContentWidth = String(Math.round(optionsContentWidth))
      document.body.dataset.sectionWidth = String(Math.round(section.getBoundingClientRect().width))
      document.body.dataset.sectionScrollWidth = String(section.scrollWidth)
      const themeRow = document.querySelector<HTMLElement>('[data-settings-theme-row]')!
      const themeButtons = [...themeRow.querySelectorAll<HTMLElement>(':scope > button')]
      const enterTitle = document.querySelector<HTMLElement>('[data-settings-enter-row] > div > div:first-child')!
      const close = document.querySelector<HTMLElement>('[data-settings-panel] > nav + div > div:first-child > button[aria-label="关闭"]')!
      document.body.dataset.themeDirection = getComputedStyle(themeRow).flexDirection
      document.body.dataset.themeWrap = getComputedStyle(themeRow).flexWrap
      document.body.dataset.themeButtonCount = String(themeButtons.length)
      document.body.dataset.themeButtonWidth = String(Math.round(themeButtons[0].getBoundingClientRect().width))
      document.body.dataset.themeButtonHeight = String(Math.round(themeButtons[0].getBoundingClientRect().height))
      document.body.dataset.themeButtonDirection = getComputedStyle(themeButtons[0]).flexDirection
      document.body.dataset.themeButtonWhiteSpace = getComputedStyle(themeButtons[0]).whiteSpace
      document.body.dataset.themeIconWidth = String(Math.round(themeButtons[0].querySelector('svg')!.getBoundingClientRect().width))
      document.body.dataset.themeIconHeight = String(Math.round(themeButtons[0].querySelector('svg')!.getBoundingClientRect().height))
      const themeLabel = themeButtons[2].querySelector<HTMLElement>('[data-theme-label]')!
      document.body.dataset.themeFontSize = getComputedStyle(themeLabel).fontSize
      document.body.dataset.themeLabelRightGap = String(Math.round(themeButtons[2].getBoundingClientRect().right - themeLabel.getBoundingClientRect().right))
      document.body.dataset.enterTitleWhiteSpace = getComputedStyle(enterTitle).whiteSpace
      document.body.dataset.closePosition = getComputedStyle(close).position
      document.body.dataset.closeTop = String(Math.round(close.getBoundingClientRect().top - panel.getBoundingClientRect().top))
      document.body.dataset.closeWidth = String(Math.round(close.getBoundingClientRect().width))
      document.body.dataset.closeHeight = String(Math.round(close.getBoundingClientRect().height))
      document.body.dataset.closeBorder = getComputedStyle(close).border
      document.body.dataset.closeBackground = getComputedStyle(close).backgroundColor
      const titleRange = document.createRange()
      titleRange.selectNodeContents(document.querySelector<HTMLElement>('[data-settings-title]')!)
      const titleRect = titleRange.getBoundingClientRect()
      const closeRect = close.getBoundingClientRect()
      document.body.dataset.closeTitleCenterDelta = String(Math.round((closeRect.top + closeRect.height / 2) - (titleRect.top + titleRect.height / 2)))
      document.body.dataset.contentMinWidth = getComputedStyle(content).minWidth
      document.body.dataset.ready = 'true'
    }, 100)
    return () => { window.clearTimeout(timer) }
  }, [])
  return <>
    <style>{`[data-settings-theme-row] > button { box-sizing: border-box; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; padding: 20px 32px; border: 1px solid; font-size: 14px; line-height: 22px; }`}</style>
    <MobileFrame
      useStore={useStore as never}
      useSessions={useSessions as never}
      actions={actions as never}
      renderSlot={renderSlot as never}
    />
  </>
}

createRoot(document.getElementById('root')!).render(<App />)
