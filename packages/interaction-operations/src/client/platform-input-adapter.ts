/** App Shell to plugin platform-intent bridge. */
import type { IInteractionOperations } from './operations.ts'

export const PLATFORM_BACK_EVENT = 'dsh-mobile:platform-back'

/** Consume the cancelable shell event only for handled or blocked outcomes. */
export function installPlatformInputAdapter(
  operations: IInteractionOperations,
  document: Document = globalThis.document,
): () => void {
  const onBack = (event: Event): void => {
    const outcome = operations.dispatch({
      type: 'back', source: { kind: 'platform', detail: 'android-back' },
    })
    if (outcome.status !== 'unhandled') event.preventDefault()
  }
  document.addEventListener(PLATFORM_BACK_EVENT, onBack)
  return () => document.removeEventListener(PLATFORM_BACK_EVENT, onBack)
}
