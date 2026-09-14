/**
 * ctx.layout face. Method set matches 0.1.5 ILayout; openDetails/closeDetails
 * stay as aliases so interaction-operations still dismisses the overlay.
 */
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type { createMobileLayoutStore, PanelInfo } from './stores.ts'

export type { PanelInfo }

/** Bound store actions. */
export type PanelActions = BoundActions<ReturnType<typeof createMobileLayoutStore>>

/** Cross-plugin panel-action face (ctx.layout). */
export interface IMobileLayout {
  toggleSidebar(): void
  selectPanel(id: string | null): void
  beginNavigation(): AbortSignal
  openRightbar(track?: boolean, fullscreen?: boolean): void
  closeRightbar(): void
  /** Alias of openRightbar(false, true) for the 0.1.2 back-stack adapter. */
  openDetails(): void
  /** Alias of closeRightbar. */
  closeDetails(): void
}

/** Cross-plugin panel-action face (ctx.layout). */
export class MobileLayoutController implements IMobileLayout {
  #panels: PanelActions | undefined
  #navigation: AbortController | undefined
  #hasMainPanel: ((id: string) => boolean) | undefined

  /** Wire store actions and the keyed-main occupancy probe. */
  attachPanels(actions: PanelActions, hasMainPanel?: (id: string) => boolean): void {
    this.#panels = actions
    this.#hasMainPanel = hasMainPanel
  }

  toggleSidebar(): void {
    this.#require().toggleSidebar()
  }

  selectPanel(id: string | null): void {
    if (id !== null && this.#hasMainPanel !== undefined && !this.#hasMainPanel(id)) {
      throw new Error('layout.selectPanel: main panel "' + id + '" is not registered')
    }
    this.#navigation?.abort()
    this.#require().selectPanel(id)
  }

  beginNavigation(): AbortSignal {
    this.#navigation?.abort()
    const next = new AbortController()
    this.#navigation = next
    return next.signal
  }

  openRightbar(track?: boolean, fullscreen?: boolean): void {
    this.#require().openRightbar(track, fullscreen)
  }

  closeRightbar(): void {
    this.#require().closeRightbar()
  }

  openDetails(): void {
    this.#require().openDetails()
  }

  closeDetails(): void {
    this.#require().closeDetails()
  }

  #require(): PanelActions {
    if (this.#panels === undefined) throw new Error('ui-layout-mobile: panel actions not wired (root entry not mounted)')
    return this.#panels
  }
}
