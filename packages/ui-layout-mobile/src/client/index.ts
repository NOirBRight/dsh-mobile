/**
 * Mobile layout plugin, browser half: one register() call contributes
 * MobileFrame into the runtime's built-in 'root' slot and, in the same breath,
 * declares the four child slots — verbatim the upstream ui-layout contract
 * (see README.md「Slot 契约」; drift fails at load by design). Seats the
 * mobile layout store (drawer / details sheet) and wires ctx.layout, the
 * cross-plugin panel-action face consumed by ui-sidebar and ui-conversation.
 * A second effect seats the theme presenter (copied from upstream).
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type { PanelActions } from './service.ts'
import { MobileFrame } from './MobileFrame.tsx'
import { createMobileLayoutStore } from './stores.ts'
import { MobileLayoutController } from './service.ts'
import { ThemePresenter } from './theme-presenter.ts'

// Contract exports only. IMobileLayout: the ctx.layout face consumers and test
// fakes type against. OwnerShare contracts below are the render-side halves
// registrants compose against; frame components and the store factory stay
// package-internal (same convergence rule as upstream ui-layout).
export { MobileLayoutController } from './service.ts'
export type { IMobileLayout } from './service.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The outward face only; the concrete service stays inside this plugin. */
    layout: import('./service.ts').IMobileLayout
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    // VERBATIM upstream ui-layout declarations (kind + scope are the runtime
    // contract; owner types are structural). Keep JSDoc parity with upstream
    // so a contract diff is reviewable.
    /**
     * The whole left column. On mobile: the slide-out drawer body. OCCUPIED by
     * ui-sidebar's SidebarRoot, which declares the workspace and settings
     * seats inside it.
     */
    'sidebar': { kind: 'single'; scope: 'root'; owner: SidebarOwnerProps }
    /**
     * The whole center column (the mobile frame's single content column),
     * across both the no-session hero and a live conversation. OCCUPIED by
     * ui-conversation's ConversationRoot.
     */
    'conversation': { kind: 'single'; scope: 'session-maybe'; owner: ConvOwnerProps }
    /**
     * The details surface, shown when the layout opens it; on mobile a
     * full-screen sheet over the content column. OCCUPIED by
     * ui-conversation's DetailsPanel. Stays mounted while closed.
     */
    'details': { kind: 'single'; scope: 'session'; owner: DetailsOwnerProps }
    /**
     * Frame-wide floating layer, above every surface and outside their scroll
     * containers. Additive list seat for badges, toasts, status pills. The
     * layer is click-through; entries opt back into pointer events.
     */
    'shell.overlay': { kind: 'list'; scope: 'root' }
  }
}

/** Sidebar owner share: live drawer state from the frame. */
export interface SidebarOwnerProps {
  /** True when the sidebar is closed (upstream: renders the compact rail; the drawer never passes true). */
  collapsed: boolean
  /** Rendered drawer width in px. */
  width: number
}

/** Conversation owner share: business state and actions belong to the registrant. */
export interface ConvOwnerProps {}

/** Details owner share: empty — sessionId arrives as a framework-standard prop. */
export interface DetailsOwnerProps {}

/** Required services (cordis fiber inject — the loader passes all module exports as an object plugin). */
export const inject = ['slots', 'theme']

/**
 * Client plugin body: provide ctx.layout, then one register() call —
 * MobileFrame into 'root' with the four child-slot declarations, the layout
 * store seat, and the inject hook that hands the store's bound actions to the
 * service.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const layout = new MobileLayoutController()
  ctx.effect(() => {
    const disposeService = ctx.reflect.provide('layout', layout)
    const disposeRegistration = ctx.slots.register({
      name: 'root',
      children: {
        'sidebar': { kind: 'single', scope: 'root' },
        'conversation': { kind: 'single', scope: 'session-maybe' },
        'details': { kind: 'single', scope: 'session' },
        'shell.overlay': { kind: 'list', scope: 'root' },
      },
      // Exclusive store: the factory itself — the framework instantiates per
      // entry and delivers useStore/actions to MobileFrame as standard props.
      store: createMobileLayoutStore,
      inject: (actions: PanelActions) => {
        layout.attachPanels(actions)
        return {}
      },
    }, MobileFrame)
    return () => {
      disposeRegistration()
      // provide()'s disposer settles asynchronously; teardown is synchronous fire-and-forget.
      void disposeService()
    }
  }, 'ui-layout-mobile: service + root registration')

  // Theme presentation: pure DOM writes from resolved snapshots — initial
  // state through the getter once, then event-driven only; no React path.
  ctx.effect(() => {
    const presenter = new ThemePresenter()
    presenter.apply(ctx.theme.getTheme())
    const off = ctx.on('theme/change', (snapshot) => { presenter.apply(snapshot) })
    return () => {
      off()
      presenter.dispose()
    }
  }, 'ui-layout-mobile: theme presenter')
}
