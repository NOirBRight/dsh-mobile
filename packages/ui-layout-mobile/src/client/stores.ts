/**
 * The root entry's transient mobile layout store: the navigation drawer, the
 * selected global main panel, and the right panel's reported presentation.
 * Mobile has no draggable panel geometry — the desktop px widths collapse into
 * open/closed — but panel selection and the rightbar report keep the upstream
 * ui-layout store's meaning so every 0.1.5 consumer keeps working.
 *
 * Module level exports the factory only: register() receives the factory
 * (exclusive use: the framework instantiates per entry), MobileFrame derives
 * its PropsStore share from the return type, and the service face receives the
 * bound actions through the registration's inject hook.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { MainPanelId } from './service.ts'

/** Mobile layout store state. */
type MobileLayoutState = {
  drawerOpen: boolean
  panelInfo: {
    /** Null selects the Conversation; global panels keep the current Session intact. */
    activePanelId: MainPanelId | null
  }
  rightbar: {
    /** The occupant asked for the right surface to be shown. */
    track: boolean
    /** A mobile dismissal (session switch) hides the surface until the occupant reopens it. */
    dismissed: boolean
  }
}

/** Annotation twin of the actions literal below (drift fails assignability at defineStore). */
type MobileLayoutActions = {
  toggleSidebar: (draft: MobileLayoutState) => void
  closeDrawer: (draft: MobileLayoutState) => void
  selectPanel: (draft: MobileLayoutState, panelId: MainPanelId | null) => void
  retainMainPanels: (draft: MobileLayoutState, panelIds: readonly string[]) => void
  openRightbar: (draft: MobileLayoutState, track: boolean, fullscreen: boolean) => void
  closeRightbar: (draft: MobileLayoutState) => void
  dismissRightbar: (draft: MobileLayoutState) => void
}

/**
 * Create the mobile layout store handle. Actions are the complete write set:
 * toggleSidebar is named for the ctx.layout face (upstream parity) and toggles
 * the drawer; the right-panel actions mirror the upstream occupant reports.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createMobileLayoutStore(): EngineStoreHandle<MobileLayoutState, MobileLayoutActions> {
  return defineStore({
    init: (): MobileLayoutState => ({
      drawerOpen: false,
      panelInfo: { activePanelId: null },
      rightbar: { track: false, dismissed: false },
    }),
    actions: {
      toggleSidebar: (d) => { d.drawerOpen = !d.drawerOpen },
      closeDrawer: (d) => { d.drawerOpen = false },
      selectPanel: (d, panelId: MainPanelId | null) => { d.panelInfo.activePanelId = panelId },
      retainMainPanels: (d, panelIds: readonly string[]) => {
        if (d.panelInfo.activePanelId !== null && !panelIds.includes(d.panelInfo.activePanelId)) {
          d.panelInfo.activePanelId = null
        }
      },
      // The fullscreen argument is accepted for ILayout parity and ignored:
      // the mobile sheet is always viewport-sized, so the frame has no separate
      // full-screen presentation to record. ui-sidebar-right derives full-screen
      // from the owner share's viewportWidth instead.
      openRightbar: (d, track: boolean, _fullscreen: boolean) => {
        d.rightbar.track = track
        d.rightbar.dismissed = false
      },
      closeRightbar: (d) => {
        d.rightbar.track = false
        d.rightbar.dismissed = false
      },
      dismissRightbar: (d) => { d.rightbar.dismissed = true },
    },
  })
}
