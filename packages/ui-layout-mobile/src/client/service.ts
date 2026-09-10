/**
 * MobileLayoutController: the cross-plugin panel-action face behind
 * ctx.layout. Drawer and right-surface state live in the root entry's layout
 * store (stores.ts); what remains here is the contract other plugins' apply
 * worlds reach for — panel selection and navigation from ui-sidebar and
 * ui-workspace, the drawer toggle, and the right panel's presentation reports
 * from ui-sidebar-right — writes stay inside the store's declared action set,
 * delivered as the registration's bound actions.
 *
 * Method set is upstream ui-layout's ILayout: the mobile shell is a drop-in
 * replacement, so the face must not drift.
 */
import type { BoundActions, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { createMobileLayoutStore } from './stores.ts'

/** Identity of a registered main-slot occupant. */
export type MainPanelId = string

/**
 * Root-scoped navigation state exposed to panel-aware components. Mobile keeps
 * the upstream meaning: null shows the Conversation, a panel id shows that
 * occupant of the keyed main slot.
 */
export interface PanelInfo {
  /** Selected global panel; null displays the current Conversation. */
  readonly activePanelId: MainPanelId | null
}

/** Selector hook over root-scoped panel selection (the provided root standard prop). */
export type UsePanelInfo = SnapshotSelectorHook<PanelInfo>

/** The layout store's bound action set (framework-baked, draft params peeled). */
export type PanelActions = BoundActions<ReturnType<typeof createMobileLayoutStore>>

/**
 * The outward layout face (ctx.layout): upstream ILayout's method set —
 * toggleSidebar toggles the navigation drawer on mobile, and the right-panel
 * reports drive the full-screen details sheet.
 */
export interface IMobileLayout {
  /**
   * Select a global central panel without changing the current Session.
   * @param panelId - registered main key, or null to show the Conversation.
   * @throws if the selected main key is not registered; preserves the current selection.
   */
  selectPanel(panelId: MainPanelId | null): void
  /**
   * Start an asynchronous navigation, superseding any earlier pending navigation.
   * @returns a signal aborted by the next navigation or layout disposal; check it before committing UI state.
   */
  beginNavigation(): AbortSignal
  /** Toggle the sidebar (mobile: the navigation drawer). */
  toggleSidebar(): void
  /**
   * Report the right panel's presentation without changing its expanded state.
   * @param track - whether the surface should be drawn.
   * @param fullscreen - whether the panel covers the frame.
   */
  openRightbar(track: boolean, fullscreen: boolean): void
  /** Report the right panel as hidden. */
  closeRightbar(): void
}

/** Cross-plugin panel-action face (ctx.layout). */
export class MobileLayoutController implements IMobileLayout {
  #panels: PanelActions | undefined
  #navigation = new AbortController()

  /**
   * @param panels - bound actions of the instance shared with the root entry.
   * @param hasMainPanel - checks the live main-slot registry for a panel id.
   */
  constructor(panels?: PanelActions, private readonly hasMainPanel: (id: MainPanelId) => boolean = () => true) {
    this.#panels = panels
  }

  /**
   * Adopt the root entry's bound store actions. Called from the root
   * registration's inject hook (a sanctioned assembly side effect); on entry
   * re-register the fresh actions overwrite the stale set.
   * @param actions - bound actions of the entry's layout store instance.
   */
  attachPanels(actions: PanelActions): void {
    this.#panels = actions
  }

  /** Select a global panel or return to the Conversation. */
  selectPanel(panelId: MainPanelId | null): void {
    if (panelId !== null && !this.hasMainPanel(panelId)) {
      throw new Error('layout.selectPanel: main panel "' + panelId + '" is not registered')
    }
    this.#navigation.abort()
    this.#require().selectPanel(panelId)
  }

  /** @returns the new pending navigation's cancellation signal. */
  beginNavigation(): AbortSignal {
    this.#navigation.abort()
    this.#navigation = new AbortController()
    return this.#navigation.signal
  }

  /** Invalidate pending navigations when the layout owner is unloaded. */
  dispose(): void {
    this.#navigation.abort()
  }

  /** Toggle the sidebar (mobile: the navigation drawer). */
  toggleSidebar(): void {
    this.#require().toggleSidebar()
  }

  /** Report the right panel's presentation. */
  openRightbar(track: boolean, fullscreen: boolean): void {
    this.#require().openRightbar(track, fullscreen)
  }

  /** Report the right panel as hidden. */
  closeRightbar(): void {
    this.#require().closeRightbar()
  }

  #require(): PanelActions {
    if (this.#panels === undefined) throw new Error('ui-layout-mobile: layout store actions are not attached yet')
    return this.#panels
  }
}
