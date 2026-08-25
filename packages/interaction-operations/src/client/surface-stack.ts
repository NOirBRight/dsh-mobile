/** Active presentation layers that participate in one-level Back semantics. */
import type { InteractionIntent, InteractionSource, InteractionTargetAdapter } from './operations.ts'

export type InteractionSurfaceKind = 'modal' | 'takeover' | 'popup' | 'details' | 'navigation'

export interface InteractionSurfaceRegistration {
  readonly id: string
  readonly kind: InteractionSurfaceKind
  dismiss(source: InteractionSource): void
}

const PRECEDENCE: readonly InteractionSurfaceKind[] = ['modal', 'takeover', 'popup', 'details', 'navigation']

interface Entry { readonly token: symbol; readonly surface: InteractionSurfaceRegistration }

/** Policy-owned LIFO ledger. Registration lifetime is the active lifetime. */
export class InteractionSurfaceStack implements InteractionTargetAdapter {
  readonly name = 'registered-surfaces'
  readonly #entries: Entry[] = []

  register(surface: InteractionSurfaceRegistration): () => void {
    if (this.#entries.some(entry => entry.surface.id === surface.id)) {
      throw new Error(`interaction surface "${surface.id}" is already active`)
    }
    const entry = { token: Symbol(surface.id), surface }
    this.#entries.push(entry)
    return () => {
      const index = this.#entries.findIndex(candidate => candidate.token === entry.token)
      if (index >= 0) this.#entries.splice(index, 1)
    }
  }

  handle(intent: InteractionIntent, kinds: readonly InteractionSurfaceKind[] = PRECEDENCE): boolean {
    if (intent.type !== 'back') return false
    for (const kind of kinds) {
      for (let index = this.#entries.length - 1; index >= 0; index -= 1) {
        const entry = this.#entries[index]
        if (entry?.surface.kind !== kind) continue
        entry.surface.dismiss(intent.source)
        return true
      }
    }
    return false
  }
}
