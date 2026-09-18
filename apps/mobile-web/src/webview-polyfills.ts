/**
 * OEM WebView 101 (MICRO 2) is older than the Host 0.1.6 client graph.
 * `@deepseek-ai/dsh-api-gateway` opens `$events` with `AbortSignal.any`;
 * without it the generation throws immediately and Connection reconnects forever.
 * Official timer/HMR vendors also call `Promise.withResolvers`.
 */

type AbortSignalCtor = typeof AbortSignal
type PromiseCtor = typeof Promise & {
  withResolvers?: <T>() => {
    promise: Promise<T>
    resolve: (value: T | PromiseLike<T>) => void
    reject: (reason?: unknown) => void
  }
}

function installAbortSignalAny(AbortSignalRef: AbortSignalCtor): void {
  if (typeof AbortSignalRef.any === 'function') return
  AbortSignalRef.any = (signals: AbortSignal[]): AbortSignal => {
    const controller = new AbortController()
    const abortFrom = (signal: AbortSignal): void => {
      const reason = signal.reason
      if (controller.signal.aborted) return
      if (reason === undefined) controller.abort()
      else controller.abort(reason)
    }
    const onAbort = (event: Event): void => {
      abortFrom(event.target instanceof AbortSignal ? event.target : (event.currentTarget as AbortSignal))
    }
    for (const signal of signals) {
      if (signal.aborted) {
        abortFrom(signal)
        return controller.signal
      }
      signal.addEventListener('abort', onAbort)
    }
    return controller.signal
  }
}

function installPromiseWithResolvers(PromiseRef: PromiseCtor): void {
  if (typeof PromiseRef.withResolvers === 'function') return
  PromiseRef.withResolvers = <T>() => {
    let resolve!: (value: T | PromiseLike<T>) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }
}

/** Install the WebView 101 floor used by the official 0.1.6 `$events` client. */
export function installWebViewPolyfills(
  scope: { AbortSignal: AbortSignalCtor; Promise: PromiseCtor } = globalThis,
): void {
  installAbortSignalAny(scope.AbortSignal)
  installPromiseWithResolvers(scope.Promise)
}

installWebViewPolyfills()
