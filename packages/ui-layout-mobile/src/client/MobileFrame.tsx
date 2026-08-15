/**
 * Mobile shell frame, registered into the built-in 'root' slot (the web shell
 * renders only 'root'). Single content column with a top bar (menu button),
 * a slide-out navigation drawer (the 'sidebar' seat), a full-screen details
 * sheet (the 'details' seat), and the frame-wide overlay layer. Safe-area
 * insets pad the top bar and the content bottom.
 *
 * Drawer and sheet stay mounted while closed (CSS transform off-surface), so
 * occupants keep their React identity and state — the mobile mirror of
 * upstream AppFrame's never-unmount columns. Pure component: everything
 * arrives through the three framework shares — zero cordis or framework
 * imports, zero self-made hooks.
 */
import { useLayoutEffect, useRef } from 'react'
import type { PropsRenderSlots, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { createMobileLayoutStore } from './stores.ts'
import css from './MobileFrame.module.css'

/** Full composed props: runtime share + child-slot render share + store share. */
export type MobileFrameProps =
  & PropsRuntime<'root'>
  & PropsRenderSlots<'sidebar' | 'conversation' | 'details' | 'shell.overlay'>
  & PropsStore<ReturnType<typeof createMobileLayoutStore>>

/** Drawer width handed to the sidebar occupant as an owner param (px). */
const DRAWER_WIDTH = 300

/** The mobile shell frame (see module doc). */
export function MobileFrame({
  useStore,
  useSessions,
  actions,
  renderSlot,
}: MobileFrameProps) {
  const panels = useStore(s => s)
  const detailsSession = useSessions((s) => {
    const current = s.current
    return current !== undefined && s.byId[current]?.blank === false ? current : undefined
  })

  // Session switch closes the details sheet and the drawer: on mobile both
  // cover the content column, so keeping them open across navigation strands
  // the user on a stale surface (upstream closes details only; the drawer
  // dismissal is the mobile addition).
  const lastSession = useRef(detailsSession)
  useLayoutEffect(() => {
    if (detailsSession === undefined) return
    if (lastSession.current !== undefined && lastSession.current !== detailsSession) {
      actions.closeDetails()
      actions.closeDrawer()
    }
    lastSession.current = detailsSession
  }, [actions, detailsSession])

  return (
    <div
      className={css.frame}
      data-drawer-open={panels.drawerOpen || undefined}
      data-details-open={panels.detailsOpen || undefined}
    >
      <header className={css.topbar}>
        <button
          type="button"
          className={css.menuButton}
          aria-label="打开导航菜单"
          onClick={() => actions.toggleSidebar()}
        >
          ☰
        </button>
        <div className={css.brand}>DeepSeek Harness</div>
      </header>
      <main className={css.center}>
        {renderSlot('conversation', {})}
      </main>
      <div className={css.scrim} onClick={() => actions.closeDrawer()} />
      <nav className={css.drawer} aria-label="导航抽屉">
        {/* Owner params mirror the desktop contract: the drawer is always
            expanded while visible, so the occupant never renders the rail. */}
        {renderSlot('sidebar', { collapsed: false, width: DRAWER_WIDTH })}
      </nav>
      <section className={css.detailsSheet} aria-label="详情面板">
        {renderSlot('details', {})}
      </section>
      <div className={css.overlayLayer} data-shell-overlay>
        {renderSlot('shell.overlay', {})}
      </div>
    </div>
  )
}
