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
import { useLayoutEffect, useRef, useState } from 'react'
import type { PropsRenderSlots, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { createMobileLayoutStore } from './stores.ts'
import css from './MobileFrame.module.css'

/** Official expanded-sidebar geometry used whenever the viewport permits it. */
export const OFFICIAL_DRAWER_WIDTH = 280

/** Normalize an observer reading without replacing a real width with a transient zero. */
export function resolveRenderedDrawerWidth(measured: number | undefined, previous: number): number {
  if (measured !== undefined && Number.isFinite(measured) && measured > 0) return measured
  return previous > 0 ? previous : OFFICIAL_DRAWER_WIDTH
}

/** Full composed props: runtime share + child-slot render share + store share. */
export type MobileFrameProps =
  & PropsRuntime<'root'>
  & PropsRenderSlots<'sidebar' | 'conversation' | 'details' | 'shell.overlay'>
  & PropsStore<ReturnType<typeof createMobileLayoutStore>>

/** The mobile shell frame (see module doc). */
export function MobileFrame({
  useStore,
  useSessions,
  actions,
  renderSlot,
}: MobileFrameProps) {
  const panels = useStore(s => s)
  const drawerRef = useRef<HTMLElement | null>(null)
  const [drawerWidth, setDrawerWidth] = useState(OFFICIAL_DRAWER_WIDTH)
  const drawerWidthRef = useRef(drawerWidth)
  drawerWidthRef.current = drawerWidth
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

  // Publish the rendered drawer box, including viewport constraints, to its owner.
  useLayoutEffect(() => {
    const drawer = drawerRef.current
    if (drawer === null) return
    const measure = () => {
      const width = resolveRenderedDrawerWidth(drawer.getBoundingClientRect().width, drawerWidthRef.current)
      drawerWidthRef.current = width
      setDrawerWidth(width)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(drawer)
    return () => { observer.disconnect() }
  }, [])

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
      </header>
      <main className={css.center}>
        {renderSlot('conversation', {})}
      </main>
      <div className={css.scrim} onClick={() => actions.closeDrawer()} />
      <nav
        ref={drawerRef}
        className={css.drawer}
        aria-label="导航抽屉"
        onClick={(event) => {
          // Session rows and search results expose aria-selected; workspace
          // treeitems expose aria-expanded instead and must keep the drawer open.
          // Row action buttons stop propagation, so their menus remain usable.
          const target = event.target
          if (target instanceof Element && target.closest('[role="treeitem"][aria-selected]') !== null) {
            actions.closeDrawer()
          }
        }}
      >
        {/* Owner params mirror the desktop contract: the drawer is always
            expanded while visible, so the occupant never renders the rail. */}
        {renderSlot('sidebar', { collapsed: false, width: drawerWidth })}
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
