import assert from 'node:assert/strict'
import test from 'node:test'

import { installLegacyBlankPresetAdapter } from '../../../packages/ui-layout-mobile/src/client/legacy-blank-preset.ts'

function sessionsHarness(summary) {
  const listeners = new Set()
  let snapshot = {
    current: summary?.id,
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

test('reused legacy blank receives the default preset so the hero mode picker can render', async () => {
  const harness = sessionsHarness({ id: 'legacy', blank: true, projectionValues: {} })
  const selected = []
  const remote = {
    agentPresets: {
      async list() {
        return {
          ok: true,
          value: {
            presets: [
              { id: 'standard', isDefault: false },
              { id: 'ptc', isDefault: true },
            ],
          },
        }
      },
      async select(sessionId, presetId) {
        selected.push([sessionId, presetId])
        return { ok: true, value: presetId }
      },
    },
  }

  const dispose = installLegacyBlankPresetAdapter({ sessions: harness.sessions, remote })
  await new Promise(resolve => setTimeout(resolve, 0))

  assert.deepEqual(selected, [['legacy', 'ptc']])
  dispose()
})

test('started and already-composed sessions keep their preset untouched', async () => {
  for (const summary of [
    { id: 'started', blank: false, projectionValues: {} },
    { id: 'composed', blank: true, projectionValues: { agentPreset: 'minimal' } },
  ]) {
    const harness = sessionsHarness(summary)
    let calls = 0
    const dispose = installLegacyBlankPresetAdapter({
      sessions: harness.sessions,
      remote: {
        agentPresets: {
          async list() { calls += 1; return { ok: true, value: { presets: [] } } },
          async select() { calls += 1; return { ok: true, value: '' } },
        },
      },
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(calls, 0)
    dispose()
  }
})

test('duplicate session-list notifications coalesce one legacy repair', async () => {
  const summary = { id: 'legacy', blank: true, projectionValues: {} }
  const harness = sessionsHarness(summary)
  let finish
  const selected = []
  const dispose = installLegacyBlankPresetAdapter({
    sessions: harness.sessions,
    remote: {
      agentPresets: {
        async list() { return { ok: true, value: { presets: [{ id: 'ptc', isDefault: true }] } } },
        async select(sessionId, presetId) {
          selected.push([sessionId, presetId])
          await new Promise(resolve => { finish = resolve })
          return { ok: true, value: presetId }
        },
      },
    },
  })

  harness.emit({ current: summary.id, byId: { [summary.id]: summary } })
  harness.emit({ current: summary.id, byId: { [summary.id]: summary } })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(selected, [['legacy', 'ptc']])
  finish()
  dispose()
})
