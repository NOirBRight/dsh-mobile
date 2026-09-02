import assert from 'node:assert/strict'
import test from 'node:test'

import {
  hostModelFallback,
  installHostModelFallbackAdapter,
} from '../../../packages/ui-layout-mobile/src/client/host-model-fallback.ts'

function sessionsHarness(summary, current = summary?.id) {
  const listeners = new Set()
  let snapshot = {
    current,
    byId: summary === undefined ? {} : { [summary.id]: summary },
  }
  return {
    sessions: {
      list: {
        getSnapshot: () => snapshot,
        subscribe(listener) {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
      },
    },
    emit(next) {
      snapshot = next
      for (const listener of listeners) listener()
    },
  }
}

const groups = [
  {
    id: 'codex',
    name: 'Codex',
    models: [{ id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' }],
  },
  {
    id: 'grok',
    name: 'Grok',
    models: [{
      id: 'grok-4.6',
      name: 'Grok 4.6',
      reasoning: {
        efforts: [{ id: 'high', name: 'High' }],
        defaultEffort: 'high',
      },
    }],
  },
]

test('an unavailable Host default is remapped to the unique live provider for the same model', () => {
  assert.deepEqual(hostModelFallback({
    current: { provider: 'cursor', model: 'grok-4.6', reasoningEffort: 'high' },
    groups,
  }), { provider: 'grok', model: 'grok-4.6', reasoningEffort: 'high' })
})

test('fallback chooses the first advertised Host model and drops an unsupported effort', () => {
  assert.deepEqual(hostModelFallback({
    current: { provider: 'missing', model: 'removed', reasoningEffort: 'max' },
    groups,
  }), { provider: 'codex', model: 'gpt-5.6-sol' })
})

test('only the active blank Session repairs an unroutable Host selection', async () => {
  const summary = { id: 'draft', blank: true }
  const harness = sessionsHarness(summary)
  const selected = []
  const directory = {
    async load() {
      return {
        current: { provider: 'cursor', model: 'grok-4.6', reasoningEffort: 'high' },
        routable: false,
        groups,
        failures: [],
        status: 'ready',
        error: null,
      }
    },
    async select(selection) { selected.push(selection) },
  }
  const dispose = installHostModelFallbackAdapter({
    sessions: harness.sessions,
    modelDirectories: { directoryFor: () => directory },
  })

  harness.emit({ current: summary.id, byId: { [summary.id]: summary } })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(selected, [{ provider: 'grok', model: 'grok-4.6', reasoningEffort: 'high' }])
  dispose()
})

test('routable, started, and inactive Sessions are not changed', async () => {
  for (const { summary, current, shouldLoad, state } of [
    {
      summary: { id: 'routable', blank: true },
      current: 'routable',
      shouldLoad: true,
      state: { current: { provider: 'codex', model: 'gpt-5.6-sol' }, routable: true, groups },
    },
    {
      summary: { id: 'started', blank: false },
      current: 'started',
      shouldLoad: false,
      state: { current: { provider: 'cursor', model: 'grok-4.6' }, routable: false, groups },
    },
    {
      summary: { id: 'inactive', blank: true },
      current: 'other',
      shouldLoad: false,
      state: { current: { provider: 'cursor', model: 'grok-4.6' }, routable: false, groups },
    },
  ]) {
    const harness = sessionsHarness(summary, current)
    let selections = 0
    let loads = 0
    const dispose = installHostModelFallbackAdapter({
      sessions: harness.sessions,
      modelDirectories: {
        directoryFor: () => ({
          async load() { loads += 1; return { ...state, failures: [], status: 'ready', error: null } },
          async select() { selections += 1 },
        }),
      },
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(selections, 0)
    assert.equal(loads, shouldLoad ? 1 : 0)
    dispose()
  }
})
