/** Native Back arbitration without exposing the Capacitor bridge to Host UI. */
export const MOBILE_PLATFORM_BACK_EVENT = 'dsh-mobile:platform-back'

export interface PlatformBackFallback {
  historyBack(): void
  exitApp(): void | Promise<void>
}

/**
 * Give the interaction plugin one synchronous, cancelable chance to consume
 * Back. Only an unconsumed request reaches browser history or native exit.
 */
export function routePlatformBack(
  document: Document,
  canGoBack: boolean,
  fallback: PlatformBackFallback,
): 'consumed' | 'history' | 'exit' {
  const request = new CustomEvent(MOBILE_PLATFORM_BACK_EVENT, { cancelable: true })
  document.dispatchEvent(request)
  if (request.defaultPrevented) return 'consumed'
  if (canGoBack) {
    fallback.historyBack()
    return 'history'
  }
  void fallback.exitApp()
  return 'exit'
}
