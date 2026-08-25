/** Modality-independent Interaction Intent routing. */
import { InteractionSurfaceStack } from './surface-stack.ts'
import type { InteractionSurfaceRegistration } from './surface-stack.ts'

export type InteractionSourceKind = 'touch' | 'keyboard' | 'platform' | 'spatial' | 'programmatic'

export interface InteractionSource {
  /** Input family, not a device brand or platform-specific event name. */
  kind: InteractionSourceKind
  /** Optional diagnostic detail such as android-back or edge-swipe. */
  detail?: string
}

export type InteractionIntent =
  | { type: 'back'; source: InteractionSource }
  | { type: 'open-navigation'; source: InteractionSource }
  | { type: 'close-navigation'; source: InteractionSource }
  | { type: 'open-context-actions'; source: InteractionSource; target: EventTarget | null }
  | { type: 'open-popup'; source: InteractionSource; target: EventTarget | null }

export type InteractionOutcome =
  | { status: 'handled'; adapter: string }
  | { status: 'unhandled' }
  | { status: 'blocked'; adapter: string; error: unknown }

/** Outward face: all input adapters submit the same small intent vocabulary. */
export interface IInteractionOperations {
  /** Resolve synchronously so a native back callback can decide whether to fall through. */
  dispatch(intent: InteractionIntent): InteractionOutcome
  /** Register one active presentation surface; disposing removes it from Back resolution. */
  registerSurface(surface: InteractionSurfaceRegistration): () => void
}

/** Internal target Adapter. Ordering in the constructor is authoritative. */
export interface InteractionTargetAdapter {
  readonly name: string
  handle(intent: InteractionIntent): boolean
}

/**
 * Routes one intent to the first target Adapter that accepts it.
 * Adapter failures block fall-through: a broken overlay must not turn Back into
 * an accidental history navigation or application exit.
 */
export class InteractionOperations implements IInteractionOperations {
  readonly #adapters: readonly InteractionTargetAdapter[]
  readonly #surfaces: InteractionSurfaceStack

  constructor(adapters: readonly InteractionTargetAdapter[], surfaces = new InteractionSurfaceStack()) {
    this.#adapters = [...adapters]
    this.#surfaces = surfaces
  }

  registerSurface(surface: InteractionSurfaceRegistration): () => void {
    return this.#surfaces.register(surface)
  }

  dispatch(intent: InteractionIntent): InteractionOutcome {
    for (const adapter of this.#adapters) {
      try {
        if (adapter.handle(intent)) return { status: 'handled', adapter: adapter.name }
      } catch (error) {
        return { status: 'blocked', adapter: adapter.name, error }
      }
    }
    try {
      if (this.#surfaces.handle(intent)) return { status: 'handled', adapter: this.#surfaces.name }
    } catch (error) {
      return { status: 'blocked', adapter: this.#surfaces.name, error }
    }
    return { status: 'unhandled' }
  }
}
