import React, { useMemo } from 'react'
import { createRoot } from 'react-dom/client'
import { MobileFrame } from '../../../../../packages/ui-layout-mobile/src/client/MobileFrame.tsx'
import { mountFirstRunScreen } from '../../../src/first-run-screen.ts'

const TOKENS = `
:root {
  --dsw-alias-bg-base: #f7f8fb;
  --dsw-alias-bg-layer-1: #ffffff;
  --dsw-alias-bg-layer-2: #ffffff;
  --dsw-alias-bg-module-platform: #f3f5f9;
  --dsw-specific-sidebar-fill: #ffffff;
  --dsw-alias-label-primary: #1f2937;
  --dsw-alias-label-secondary: #4b5563;
  --dsw-alias-label-tertiary: #718096;
  --dsw-alias-label-caption: #8a95a8;
  --dsw-alias-label-inverse: #ffffff;
  --dsw-alias-border-l1: #dfe5ef;
  --dsw-alias-border-l2: rgba(31, 41, 55, .08);
  --dsw-alias-interactive-bg-hover: #edf2fa;
  --dsw-alias-button-floating-fill: #ffffff;
  --dsw-alias-state-business-primary: #4e78cc;
  --dsw-alias-state-business-tertiary: #e8efff;
  --dsw-alias-state-success-primary: #22c55e;
  --dsw-alias-state-warn-primary: #f59e0b;
  --dsw-alias-state-error-primary: #c2413a;
  --dsw-alias-brand-primary: #4e78cc;
  --ds-font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --ds-transition-duration-slow: 0ms;
  --ds-ease-in-out: linear;
}
html, body, #root { margin: 0; height: 100%; background: var(--dsw-alias-bg-base); font-family: var(--ds-font-family); color: var(--dsw-alias-label-primary); }
.shot { width: 390px; height: 844px; overflow: hidden; position: relative; }
.dcs-overlay { position: absolute; inset: 0; pointer-events: none; }
.dcs-toggle { position: absolute; top: 4px; right: 4px; width: 40px; height: 40px; border: 0; border-radius: 10px; background: transparent; color: var(--dsw-alias-label-primary); pointer-events: auto; }
.dcs-root { height: 100%; display: flex; flex-direction: column; background: var(--dsw-alias-bg-base); }
.dcs-tabbar { display: flex; gap: 4px; align-items: center; padding: 8px 10px; background: var(--dsw-alias-bg-layer-1); }
.dcs-tab { border: 0; background: var(--dsw-alias-bg-module-platform); border-radius: 8px; padding: 6px 10px; font: 600 12px/1.2 var(--ds-font-family); color: var(--dsw-alias-label-primary); }
.dcs-tab[data-on] { box-shadow: inset 0 0 0 1.5px var(--dsw-alias-label-primary); }
.dcs-files { padding: 12px 14px; font-size: 13px; line-height: 1.7; }
.dcs-files code { font-size: 12px; }
.bubble { max-width: 88%; margin: 10px 16px; padding: 10px 12px; border-radius: 14px; font-size: 14px; line-height: 1.55; }
.bubble.user { margin-left: auto; background: var(--dsw-alias-state-business-tertiary); }
.bubble.agent { background: var(--dsw-alias-bg-layer-1); box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l2); }
.stats { margin: 0 16px 8px; color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.composer { margin: 8px 12px 12px; padding: 10px 12px 8px; border-radius: 16px; background: var(--dsw-alias-bg-layer-1); box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l2); }
.composer p { margin: 0 0 8px; color: var(--dsw-alias-label-caption); font-size: 14px; }
.nav { padding: 16px 12px; }
.nav h1 { margin: 0 0 16px; font-size: 16px; }
.nav button { display: block; width: 100%; text-align: left; border: 0; background: transparent; padding: 10px 8px; border-radius: 10px; font: inherit; }
.nav button[data-on] { background: var(--dsw-alias-interactive-bg-hover); }
.pair { padding: 16px; }
.pair h2 { margin: 0; font-size: 16px; font-weight: 500; }
.pair .muted { margin: 6px 0 0; color: var(--dsw-alias-label-tertiary); font-size: 13px; line-height: 20px; }
.card { display: grid; gap: 10px; padding: 12px; border-radius: 14px; background: var(--dsw-alias-bg-layer-1); box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l2); }
.modes { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; }
.modes button { min-height: 48px; text-align: left; border: 0; border-radius: 12px; padding: 10px 12px; background: transparent; box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l2); }
.modes button[data-on] { background: var(--dsw-alias-bg-module-platform); box-shadow: inset 0 0 0 1.5px var(--dsw-alias-label-primary); }
.qr { width: 220px; aspect-ratio: 1; margin: 8px auto 0; display: grid; place-items: center; border-radius: 12px; border: 1px dashed var(--dsw-alias-border-l2); color: var(--dsw-alias-label-tertiary); text-align: center; padding: 12px; }
.pill { position: absolute; top: 58px; left: 50%; transform: translateX(-50%); z-index: 30; display: flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 999px; background: var(--dsw-alias-bg-layer-2); box-shadow: 0 4px 14px rgba(0,0,0,.18); font-size: 12px; font-weight: 500; }
.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--dsw-alias-state-success-primary); }
`

const sessions = { current: 's1', byId: { s1: { blank: false, displayTitle: 'Narrow layout' } } }
const useSessions = (select: (state: typeof sessions) => unknown) => select(sessions)

function Conversation() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', ['--dsh-composer-side-clearance' as string]: '16px' }}>
      <header data-session-header style={{ padding: '8px 12px 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div role="tablist" style={{ display: 'flex', gap: 12, fontSize: 13 }}>
            <button type="button" role="tab">对话</button>
            <button type="button" role="tab">轨迹</button>
          </div>
          <div data-header-utility><button type="button">日志</button></div>
        </div>
      </header>
      <div data-chat-scroll style={{ flex: 1, overflow: 'hidden' }}>
        <div className="bubble user">手机上官方三栏会被挤成一条，会话还在，只是没法下手。</div>
        <div className="bubble agent">窄屏只改构图：顶栏、会话单栏、导航抽屉，details 留给 Codex 侧栏。功能仍是 Host 上的官方模块。</div>
        <p className="stats">2 轮 · 18 步 · 62 tok/s · ↑1.2K ↓0.8K</p>
      </div>
      <div className="composer" data-composer-card>
        <p>发给 DeepSeek Harness</p>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--dsw-alias-label-tertiary)', fontSize: 12 }}>
          <span>命令 / 图片</span>
          <span>发送</span>
        </div>
      </div>
    </div>
  )
}

function Nav() {
  return (
    <div className="nav">
      <h1>DeepSeek Harness</h1>
      <button type="button">新建会话</button>
      <button type="button" data-on>Narrow layout</button>
      <button type="button">设置</button>
    </div>
  )
}

function CodexFiles() {
  return (
    <div className="dcs-root">
      <div className="dcs-tabbar">
        <button type="button" className="dcs-tab" data-on>Files</button>
        <button type="button" className="dcs-tab">Review</button>
        <button type="button" className="dcs-tab">Browser</button>
        <button type="button" className="dcs-tab">Terminal</button>
      </div>
      <div className="dcs-files">
        <div>example-app</div>
        <div><code>README.md</code></div>
        <div><code>src/layout.ts</code></div>
        <div><code>src/tunnel.ts</code></div>
      </div>
    </div>
  )
}

function Frame({ drawerOpen, detailsOpen }: { drawerOpen: boolean; detailsOpen: boolean }) {
  const panels = { drawerOpen, detailsOpen }
  const useStore = (select: (state: typeof panels) => unknown) => select(panels)
  const actions = useMemo(() => ({
    toggleSidebar() {},
    closeDrawer() {},
    openDetails() {},
    closeDetails() {},
  }), [])
  const renderSlot = (name: string) => {
    if (name === 'sidebar') return <Nav />
    if (name === 'conversation') return <Conversation />
    if (name === 'details') return <CodexFiles />
    if (name === 'shell.overlay') {
      return <div className="dcs-overlay"><button type="button" className="dcs-toggle" aria-label="Codex">▦</button></div>
    }
    return null
  }
  return (
    <MobileFrame
      useStore={useStore as never}
      useSessions={useSessions as never}
      actions={actions as never}
      renderSlot={renderSlot as never}
    />
  )
}

function PairingCard() {
  return (
    <div className="pair">
      <header>
        <h2>远程</h2>
        <p className="muted">用手机 App 扫码，连到这台电脑。</p>
      </header>
      <div className="card">
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 500 }}>访问方式</h3>
        <div className="modes">
          <button type="button" data-on><strong>自动生成</strong><span className="muted" style={{ display: 'block' }}>自动生成连接地址</span></button>
          <button type="button"><strong>填写地址</strong><span className="muted" style={{ display: 'block' }}>使用你部署的服务</span></button>
        </div>
        <div style={{ padding: 12, borderRadius: 12, background: 'var(--dsw-alias-bg-module-platform)' }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 500 }}>扫码连接</h3>
          <p className="muted">用 App 扫码。二维码约 5 分钟有效，过期后点这里换一张。</p>
          <div className="qr" role="img" aria-label="Expired pairing placeholder">
            <strong style={{ fontSize: 34, letterSpacing: '.12em' }}>QR</strong>
            <span style={{ fontSize: 12 }}>二维码已过期，点这里换一张</span>
          </div>
        </div>
      </div>
      <div className="card" style={{ marginTop: 12 }}>
        <strong>Pixel</strong>
        <p className="muted" style={{ margin: 0 }}>手机 · 最近在线 刚刚</p>
      </div>
    </div>
  )
}

function FirstRun() {
  const host = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    if (host.current === null) return
    const screen = mountFirstRunScreen(host.current)
    return () => screen.destroy()
  }, [])
  return <div ref={host} className="shot" />
}

function App() {
  const scene = new URLSearchParams(location.search).get('scene') ?? 'session'
  return (
    <>
      <style>{TOKENS}</style>
      {scene === 'first-run' ? <FirstRun /> : (
        <div className="shot" data-ready="true">
          {scene === 'session' ? <Frame drawerOpen={false} detailsOpen={false} /> : null}
          {scene === 'drawer' ? <Frame drawerOpen detailsOpen={false} /> : null}
          {scene === 'codex' ? <Frame drawerOpen={false} detailsOpen /> : null}
          {scene === 'pair' ? <PairingCard /> : null}
          {scene === 'connect' ? <>
            <Frame drawerOpen={false} detailsOpen={false} />
            <div className="pill"><span className="dot" /><span>Relay · 已连接</span></div>
          </> : null}
        </div>
      )}
    </>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
