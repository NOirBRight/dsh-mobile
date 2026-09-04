import { installAgentPresetFallback } from '../../../../../packages/ui-layout-mobile/src/client/agent-preset-fallback.ts'

const state = { current: undefined, byId: {} }
const listeners = new Set<() => void>()
const ctx = {
  remote: {
    agentPresets: {
      async list() {
        return { result: { ok: true, value: { presets: [{ id: 'standard', isDefault: true }, { id: 'ptc' }] } } }
      },
      async select(_sessionId: string, _preset: string) { return { result: { ok: true, value: _preset } } },
    },
  },
  sessions: { list: {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener) },
  } },
}

installAgentPresetFallback(ctx)
setTimeout(() => {
  const button = document.querySelector<HTMLButtonElement>('[data-mobile-agent-preset-fallback]')
  button?.click()
  const menu = document.querySelector<HTMLElement>('[data-mobile-agent-preset-menu]')
  if (menu !== null) menu.dataset.menuOpen = String(!menu.hidden)
  document.body.dataset.ready = 'true'
}, 50)
