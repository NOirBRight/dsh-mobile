type ReadinessSnapshot = { generation: number; state: 'pending' | 'ready' | 'error' }
type ReadinessStore = {
  getSnapshot(): ReadinessSnapshot
  subscribe(listener: () => void): () => void
}
type MobileHydrationBridge = {
  adapter: unknown
  dispose?(): void | Promise<void>
}

declare global {
  // Prepared by the mobile shell only after exact runtime compatibility succeeds.
  var __DSH_MOBILE_SESSION_HYDRATION__: MobileHydrationBridge | undefined
}

export const name = '@dsh-mobile/session-hydration/client'

function publish(snapshot: ReadinessSnapshot): void {
  document.documentElement.dataset.dshLiveDataReadiness = 'v1'
  document.dispatchEvent(new CustomEvent('dsh:live-data-state', { detail: snapshot }))
  if (snapshot.state === 'ready') document.dispatchEvent(new CustomEvent('dsh:live-data-ready', { detail: snapshot }))
}

/** Register the prepared adapter before runtime apply, then bridge its replayable readiness store. */
export function apply(ctx: any): void {
  const bridge = globalThis.__DSH_MOBILE_SESSION_HYDRATION__
  if (bridge === undefined) return
  document.documentElement.dataset.dshLiveDataReadiness = 'v1'
  ctx.provide('sessionHydration', bridge.adapter)
  ctx.inject(['sessionBaselineReadiness'], (scope: any) => {
    const store = scope.get('sessionBaselineReadiness') as ReadinessStore
    const notify = () => { publish(store.getSnapshot()) }
    notify()
    return store.subscribe(notify)
  })
  ctx.effect(() => () => { void bridge.dispose?.() }, 'mobile: session hydration adapter')
}
