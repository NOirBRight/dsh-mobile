/**
 * The root entry's transient mobile layout store: the navigation drawer and
 * the details sheet as booleans (mobile has no draggable panel geometry —
 * the desktop px widths collapse into open/closed). Module level exports the
 * factory only: register() receives the factory (exclusive use: the
 * framework instantiates per entry), MobileFrame derives its PropsStore
 * share from the return type, and the service face receives the bound
 * actions through the registration's inject hook.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'

/** Mobile layout store state: drawer + details sheet open flags. */
type MobileLayoutState = { drawerOpen: boolean; detailsOpen: boolean }

/** Annotation twin of the actions literal below (drift fails assignability at defineStore). */
type MobileLayoutActions = {
  toggleSidebar: (draft: MobileLayoutState) => void
  closeDrawer: (draft: MobileLayoutState) => void
  openDetails: (draft: MobileLayoutState) => void
  closeDetails: (draft: MobileLayoutState) => void
}

/**
 * Create the mobile layout store handle. Actions are the complete write set;
 * toggleSidebar is named for the ctx.layout face (upstream parity), the
 * gesture toggles the drawer.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createMobileLayoutStore(): EngineStoreHandle<MobileLayoutState, MobileLayoutActions> {
  return defineStore({
    init: (): MobileLayoutState => ({ drawerOpen: false, detailsOpen: false }),
    actions: {
      toggleSidebar: (d) => { d.drawerOpen = !d.drawerOpen },
      closeDrawer: (d) => { d.drawerOpen = false },
      openDetails: (d) => { d.detailsOpen = true },
      closeDetails: (d) => { d.detailsOpen = false },
    },
  })
}
