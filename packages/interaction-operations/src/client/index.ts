/** Independently installable client plugin for cross-input Interaction Intents. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { installComposerInputAdapter } from './composer-input-adapter.ts'
import { createDomTargetAdapter } from './dom-target-adapter.ts'
import { InteractionOperations } from './operations.ts'
import { installPopupGeometryAdapter } from './popup-geometry-adapter.ts'
import { InteractionSurfaceStack } from './surface-stack.ts'
import { installPlatformInputAdapter } from './platform-input-adapter.ts'
import { installTouchInputAdapter } from './touch-input-adapter.ts'

export type {
  IInteractionOperations, InteractionIntent, InteractionOutcome,
  InteractionSource, InteractionSourceKind,
} from './operations.ts'
export type { InteractionSurfaceKind, InteractionSurfaceRegistration } from './surface-stack.ts'
export { PLATFORM_BACK_EVENT } from './platform-input-adapter.ts'

export const inject: string[] = []

/** Provide the small dispatch face, then own and retract all global input Adapters. */
export function apply(ctx: ClientContext): void {
  const surfaces = new InteractionSurfaceStack()
  const operations = new InteractionOperations([createDomTargetAdapter(ctx, document, surfaces)], surfaces)
  ctx.effect(() => {
    const disposeService = ctx.reflect.provide('interactionOperations', operations)
    const disposePlatform = installPlatformInputAdapter(operations)
    const mobileSurface = document.documentElement.dataset.dshSurface === 'mobile' ||
      matchMedia('(hover: none) and (pointer: coarse)').matches
    const disposeTouch = mobileSurface ? installTouchInputAdapter(operations) : () => {}
    const disposeComposer = mobileSurface ? installComposerInputAdapter() : () => {}
    const disposePopupGeometry = mobileSurface ? installPopupGeometryAdapter() : () => {}
    return () => {
      disposePopupGeometry()
      disposeComposer()
      disposeTouch()
      disposePlatform()
      void disposeService()
    }
  }, 'interaction-operations: service + input adapters')
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    interactionOperations: import('./operations.ts').IInteractionOperations
  }
}
