import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../../../packages/session-hydration-mobile/src/client/index.ts'

test('provider registers before runtime and publishes replayable authoritative readiness', () => {
  const priorDocument = globalThis.document
  const priorCustomEvent = globalThis.CustomEvent
  const priorBridge = globalThis.__DSH_MOBILE_SESSION_HYDRATION__
  const events = []
  const root = { dataset: {} }
  globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail } }
  globalThis.document = { documentElement: root, dispatchEvent(event) { events.push(event); return true } }
  const adapter = { readList() {}, readWindow() {}, committed() {} }
  globalThis.__DSH_MOBILE_SESSION_HYDRATION__ = { adapter }
  let injected
  const provided = new Map()
  const effects = []
  const ctx = {
    provide(key, value) { provided.set(key, value) },
    inject(keys, callback) { injected = callback },
    effect(callback) { effects.push(callback()) },
  }
  try {
    apply(ctx)
    assert.equal(provided.get('sessionHydration'), adapter)
    assert.equal(root.dataset.dshLiveDataReadiness, 'v1')
    let snapshot = { generation: 2, state: 'pending' }
    let listener
    const store = { getSnapshot: () => snapshot, subscribe(next) { listener = next; return () => {} } }
    injected({ get: () => store })
    assert.equal(events.at(-1).type, 'dsh:live-data-state')
    snapshot = { generation: 2, state: 'ready' }
    listener()
    assert.deepEqual(events.slice(-2).map(event => event.type), ['dsh:live-data-state', 'dsh:live-data-ready'])
  } finally {
    globalThis.document = priorDocument
    globalThis.CustomEvent = priorCustomEvent
    globalThis.__DSH_MOBILE_SESSION_HYDRATION__ = priorBridge
  }
})
