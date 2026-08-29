import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MobileFrame } from '../../../../../packages/ui-layout-mobile/src/client/MobileFrame.tsx'

function FrameHarness() {
  const [current, setCurrent] = useState<'a' | 'b'>('a')
  const sessions = useMemo(() => ({
    current,
    byId: {
      a: { blank: false, displayTitle: 'Session A' },
      b: { blank: false, displayTitle: 'Session B' },
    },
  }), [current])
  const useSessions = (select: (state: typeof sessions) => unknown) => select(sessions)
  const panels = { drawerOpen: true, detailsOpen: false }
  const useStore = (select: (state: typeof panels) => unknown) => select(panels)
  const actions = useMemo(() => ({
    toggleSidebar() {},
    closeDrawer() {},
    openDetails() {},
    closeDetails() {},
  }), [])
  const renderSlot = (name: string) => {
    if (name === 'sidebar') return <button
      id="session-b"
      type="button"
      role="treeitem"
      aria-selected={current === 'b'}
      onClick={() => { setCurrent('b') }}
    >Session B</button>
    if (name === 'conversation') return <div data-composer-card><textarea id="message" defaultValue="draft" /></div>
    return null
  }
  useEffect(() => {
    const timer = window.setTimeout(() => {
      document.getElementById('message')!.focus()
      document.getElementById('session-b')!.click()
      // Mirror official InputBar's sessionId effect, which focuses after the
      // layout shell has already handled the session transition.
      window.setTimeout(() => {
        document.getElementById('message')!.focus()
        window.setTimeout(() => {
          document.body.dataset.activeAfterSwitch = document.activeElement?.id ?? 'none'
          document.body.dataset.current = current
          document.body.dataset.ready = 'true'
        }, 20)
      }, 10)
    }, 80)
    return () => { window.clearTimeout(timer) }
  }, [])
  return <MobileFrame
    useStore={useStore as never}
    useSessions={useSessions as never}
    actions={actions as never}
    renderSlot={renderSlot as never}
    SessionProvider={(({ children }: { children?: React.ReactNode }) => children) as never}
  />
}

createRoot(document.getElementById('root')!).render(<FrameHarness />)
