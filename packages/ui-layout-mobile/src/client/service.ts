/**
 * MobileLayoutController: the cross-plugin panel-action face behind
 * ctx.layout. Drawer/sheet state lives in the root entry's layout store
 * (stores.ts); what remains here is the contract other plugins' apply worlds
 * reach for panel transitions (sidebar toggle from ui-sidebar, details
 * open/close from ui-conversation) — writes stay inside the store's declared
 * action set, delivered as the registration's bound actions.
 *
 * Method set is verbatim upstream ui-layout's ILayout: the mobile shell is a
 * drop-in replacement, so the face must not drift.
 */
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type { createMobileLayoutStore } from './stores.ts'

/** The layout store's bound action set (framework-baked, draft params peeled). */
export type PanelActions = BoundActions<ReturnType<typeof createMobileLayoutStore>>

/**
 * The outward layout face (ctx.layout): identical to upstream ILayout —
 * toggleSidebar toggles the navigation drawer on mobile.
 */
export interface IMobileLayout {
  /** Toggle the sidebar (mobile: the navigation drawer). */
  toggleSidebar(): void
  /** Open the details surface (mobile: the full-screen sheet). */
  openDetails(): void
  /** Close the details surface. */
  closeDetails(): void
}

/** Cross-plugin panel-action face (ctx.layout). */
export class MobileLayoutController implements IMobileLayout {
  #panels: PanelActions | undefined

  /**
   * Adopt the root entry's bound store actions. Called from the root
   * registration's inject hook (a sanctioned assembly side effect); on entry
   * re-register the fresh actions overwrite the stale set.
   * @param actions - bound actions of the entry's layout store instance.
   */
  attachPanels(actions: PanelActions): void {
    this.#panels = actions
  }

  /** Toggle the sidebar (mobile: the navigation drawer). */
  toggleSidebar(): void {
    this.#require().toggleSidebar()
  }

  /** Open the details surface (no-op when already open). */
  openDetails(): void {
    this.#require().openDetails()
  }

  /** Close the details surface. */
  closeDetails(): void {
    this.#require().closeDetails()
  }

  #require(): PanelActions {
    // Callers are UI gestures, which cannot fire before the root entry
    // rendered (the inject hook runs in its first render) — reaching this
    // unwired is a boot-order bug, not a race to tolerate.
    if (this.#panels === undefined) throw new Error('ui-layout-mobile: panel actions not wired (root entry not mounted)')
    return this.#panels
  }
}
