/**
 * Mobile layout plugin, browser half: one register() call contributes
 * MobileFrame into the runtime's built-in 'root' slot and, in the same breath,
 * declares the four child slots — verbatim the upstream ui-layout contract
 * (see README.md「Slot 契约」; drift fails at load by design). Seats the
 * mobile layout store (drawer / details sheet) and wires ctx.layout, the
 * cross-plugin panel-action face consumed by ui-sidebar and ui-conversation.
 * A second effect seats the theme presenter (copied from upstream).
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { PanelActions } from './service.ts'
import { MobileFrame } from './MobileFrame.tsx'
import type { MobileInteractionOperations } from './MobileFrame.tsx'
import { createMobileLayoutStore } from './stores.ts'
import { MobileLayoutController } from './service.ts'
import { ThemePresenter } from './theme-presenter.ts'
import { ComposerAttach } from './ComposerAttach.tsx'
import { CompactStatsLine } from './CompactStatsLine.tsx'
import { PlanToggle } from './PlanToggle.tsx'
import { commandsExecuteFrom, interpretPlanCommandResult, type PlanCommand } from './plan-toggle.ts'
import { installHistoryContinuityAdapter } from './history-continuity.ts'
import { installLegacyBlankPresetAdapter } from './legacy-blank-preset.ts'
import { installHostModelFallbackAdapter, type HostModelFallbackContext } from './host-model-fallback.ts'
import { installTurnTailPresenter } from './turn-tail-presenter.ts'
import { installModelPickerPresenter } from './model-picker-presenter.ts'
import { installPermissionLabelPresenter } from './permission-label-presenter.ts'
import { installPresetLabelPresenter } from './preset-label-presenter.ts'
import { installAgentPresetFallback, type AgentPresetFallbackContext } from './agent-preset-fallback.ts'
import type { DraftConversation } from './composer-attach.ts'

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
    /** Occupied by this package's plus-button attach control. Declared by ui-conversation (no owner: entries read session state through the standard hooks). */
    'conversation.input.left': { kind: 'list'; scope: 'session' }
    /** Occupied by this package's compact StatsLine. Declared by ui-conversation. */
    'conversation.composer.dock': { kind: 'list'; scope: 'session'; owner: object }
    /** Occupied by this package's plan-mode icon toggle. Declared by ui-conversation. */
    'conversation.input.plan': { kind: 'single'; scope: 'session'; owner: { locked: boolean } }
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
export const inject = ['slots', 'theme', 'sessions', 'remote.agentPresets', 'modelDirectories']

function interactionOperationsFrom(ctx: ClientContext): MobileInteractionOperations | undefined {
  const holder = ctx as ClientContext & { get?(name: string, strict?: boolean): unknown; interactionOperations?: unknown }
  let value: unknown
  try { value = holder.get?.('interactionOperations', false) ?? holder.interactionOperations } catch { return undefined }
  if (value === null || typeof value !== 'object') return undefined
  const candidate = value as Partial<MobileInteractionOperations>
  return typeof candidate.registerSurface === 'function' ? candidate as MobileInteractionOperations : undefined
}

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
        return { interactionOperations: interactionOperationsFrom(ctx) }
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

  ctx.effect(() => installHistoryContinuityAdapter(ctx), 'ui-layout-mobile: expanded history continuity')
  ctx.effect(
    () => installLegacyBlankPresetAdapter(ctx as ClientContext & import('./legacy-blank-preset.ts').LegacyBlankPresetContext),
    'ui-layout-mobile: legacy blank preset recovery',
  )
  ctx.effect(
    () => installAgentPresetFallback(ctx as ClientContext & AgentPresetFallbackContext),
    'ui-layout-mobile: missing hero preset recovery',
  )
  ctx.effect(
    () => installHostModelFallbackAdapter(ctx as ClientContext & HostModelFallbackContext),
    'ui-layout-mobile: unroutable Host model fallback',
  )
  ctx.effect(() => installTurnTailPresenter(), 'ui-layout-mobile: compact turn tail')
  ctx.effect(() => installModelPickerPresenter(), 'ui-layout-mobile: compact model details')
  ctx.effect(() => installPermissionLabelPresenter(), 'ui-layout-mobile: permission icon triggers')
  ctx.effect(() => installPresetLabelPresenter(), 'ui-layout-mobile: compact preset labels')

  ctx.effect(() => {
    let disposeAttach: (() => void) | undefined
    const mountAttach = (): void => {
      if (disposeAttach !== undefined) return
      try {
        disposeAttach = ctx.slots.register({
          name: 'conversation.input.left',
          id: 'composer-attach',
          order: 0,
          inject: () => draftImageInject(ctx),
        }, ComposerAttach)
      } catch {
        // ui-conversation declares this slot; retry when that roster lands.
      }
    }
    mountAttach()
    const off = ctx.on('slots/changed', (key: string) => {
      if (key === 'conversation' || key === 'conversation.input.left') mountAttach()
    })
    return () => {
      off()
      disposeAttach?.()
    }
  }, 'ui-layout-mobile: composer attach')

  ctx.effect(() => {
    let disposeStats: (() => void) | undefined
    const mountStats = (): void => {
      if (disposeStats !== undefined) return
      try {
        disposeStats = ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'stats',
          order: 0,
          // Same occupant identity as the official StatsLine, at a lower cell
          // priority so this compact mobile face shadows instead of colliding.
          priority: -1,
        }, CompactStatsLine)
      } catch {
        // ui-conversation declares this slot; retry when that roster lands.
      }
    }
    mountStats()
    const off = ctx.on('slots/changed', (key: string) => {
      if (key === 'conversation' || key === 'conversation.composer.dock') mountStats()
    })
    return () => {
      off()
      disposeStats?.()
    }
  }, 'ui-layout-mobile: compact stats')

  ctx.effect(() => {
    let disposePlan: (() => void) | undefined
    const mountPlan = (): void => {
      if (disposePlan !== undefined) return
      try {
        disposePlan = ctx.slots.register({
          name: 'conversation.input.plan',
          priority: -1,
          inject: (sessionId: string) => ({
            runPlanCommand: async (line: PlanCommand) => {
              const execute = commandsExecuteFrom(ctx)
              if (execute === undefined) return 'commands unavailable'
              return interpretPlanCommandResult(line, await execute(sessionId, line, []))
            },
          }),
        }, PlanToggle)
      } catch {
        // ui-conversation declares this slot; retry when that roster lands.
      }
    }
    mountPlan()
    const off = ctx.on('slots/changed', (key: string) => {
      if (key === 'conversation' || key === 'conversation.input.plan') mountPlan()
    })
    return () => {
      off()
      disposePlan?.()
    }
  }, 'ui-layout-mobile: plan toggle')
}

/** Slot bindings for the plus-button seat: official draft-image intake only.
 * Submission always travels the programmatic-Enter path in ComposerAttach so
 * Core's own queue/steer policy (which owns the live preference) resolves it. */
function draftImageInject(
  ctx: ClientContext,
): {
  createDraftImages: DraftConversation['createDraftImages']
  releaseDraftImage: DraftConversation['releaseDraftImage']
  releaseDraftImages: DraftConversation['releaseDraftImages']
} {
  const live = (): DraftConversation | undefined => liveConversation(ctx)
  return {
    createDraftImages: (files) => {
      const conversation = live()
      if (conversation?.createDraftImages === undefined) {
        throw new Error('ui-layout-mobile: conversation draft images unavailable')
      }
      return conversation.createDraftImages(files)
    },
    releaseDraftImage: (id) => { live()?.releaseDraftImage?.(id) },
    releaseDraftImages: (images) => { live()?.releaseDraftImages?.(images) },
  }
}

/** Layout cannot inject `conversation` (conversation already injects `layout`). */
function liveConversation(ctx: ClientContext): DraftConversation | undefined {
  const holder = ctx as ClientContext & {
    get?: (name: string, strict?: boolean) => unknown
    conversation?: DraftConversation
  }
  try {
    const value = holder.get?.('conversation', false) ?? holder.conversation
    if (value === null || typeof value !== 'object') return undefined
    return value as DraftConversation
  } catch {
    return undefined
  }
}
