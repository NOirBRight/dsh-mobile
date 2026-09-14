/**
 * Transient mobile layout store: drawer + rightbar overlay + active main panel.
 * Geometry is open/closed; desktop px widths collapse into those flags.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'

/** Active keyed main occupant; null means the default conversation. */
export type PanelInfo = { activePanelId: string | null }

type MobileLayoutState = {
  drawerOpen: boolean
  rightbarOpen: boolean
  panelInfo: PanelInfo
}

type MobileLayoutActions = {
  toggleSidebar: (draft: MobileLayoutState) => void
  closeDrawer: (draft: MobileLayoutState) => void
  selectPanel: (draft: MobileLayoutState, panelId: string | null) => void
  retainMainPanels: (draft: MobileLayoutState, panelIds: readonly string[]) => void
  openRightbar: (draft: MobileLayoutState, _track?: boolean, _fullscreen?: boolean) => void
  closeRightbar: (draft: MobileLayoutState) => void
  openDetails: (draft: MobileLayoutState) => void
  closeDetails: (draft: MobileLayoutState) => void
}

/** Factory for the root entry's layout store. */
export function createMobileLayoutStore(): EngineStoreHandle<MobileLayoutState, MobileLayoutActions> {
  return defineStore({
    init: (): MobileLayoutState => ({
      drawerOpen: false,
      rightbarOpen: false,
      panelInfo: { activePanelId: null },
    }),
    actions: {
      toggleSidebar: (d) => { d.drawerOpen = !d.drawerOpen },
      closeDrawer: (d) => { d.drawerOpen = false },
      selectPanel: (d, panelId) => {
        d.panelInfo.activePanelId = panelId
        d.drawerOpen = false
      },
      retainMainPanels: (d, panelIds) => {
        if (d.panelInfo.activePanelId !== null && !panelIds.includes(d.panelInfo.activePanelId)) {
          d.panelInfo.activePanelId = null
        }
      },
      openRightbar: (d) => { d.rightbarOpen = true },
      closeRightbar: (d) => { d.rightbarOpen = false },
      openDetails: (d) => { d.rightbarOpen = true },
      closeDetails: (d) => { d.rightbarOpen = false },
    },
  })
}
