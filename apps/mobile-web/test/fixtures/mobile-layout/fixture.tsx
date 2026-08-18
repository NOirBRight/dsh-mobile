import React, { useMemo } from 'react'
import { createRoot } from 'react-dom/client'
import { MobileFrame } from '../../../../../packages/ui-layout-mobile/src/client/MobileFrame.tsx'

const sessions = { current: 'session-a', byId: { 'session-a': { blank: false } } }
const useSessions = (select: (state: typeof sessions) => unknown) => select(sessions)
let closeCount = 0

function FrameHarness({ id, width }: { id: string; width: number }) {
  const panels = { drawerOpen: true, detailsOpen: false }
  const useStore = (select: (state: typeof panels) => unknown) => select(panels)
  const actions = useMemo(() => ({
    toggleSidebar() {},
    closeDrawer() { closeCount += 1 },
    openDetails() {},
    closeDetails() {},
  }), [])
  const renderSlot = (name: string, owner: { width?: number }) => {
    if (name === 'sidebar') {
      return <div data-owner={id} data-owner-width={owner.width}><div role="treeitem" aria-selected="true" data-session-row={id}>Session A</div></div>
    }
    if (name === 'conversation') return <div>Conversation</div>
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
      const official = document.querySelector<HTMLElement>('#official nav[aria-label="导航抽屉"]')!
      const constrained = document.querySelector<HTMLElement>('#constrained nav[aria-label="导航抽屉"]')!
      document.querySelector<HTMLElement>('[data-session-row="constrained"]')!.click()
      document.body.dataset.closeCount = String(closeCount)
      document.body.dataset.officialDrawerWidth = String(official.getBoundingClientRect().width)
      document.body.dataset.officialOwnerWidth = document.querySelector<HTMLElement>('[data-owner="official"]')!.dataset.ownerWidth
      document.body.dataset.drawerWidth = String(constrained.getBoundingClientRect().width)
      document.body.dataset.ownerWidth = document.querySelector<HTMLElement>('[data-owner="constrained"]')!.dataset.ownerWidth
      document.body.dataset.ready = 'true'
    }, 100)
    return () => { window.clearTimeout(timer) }
  }, [])
  return <><FrameHarness id="official" width={360} /><FrameHarness id="constrained" width={240} /></>
}

createRoot(document.getElementById('root')!).render(<App />)
