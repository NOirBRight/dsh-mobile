const BACKGROUND_CONNECTION_PREFERENCE_KEY = 'dsh-mobile:background-connection:v1'

export interface PreferenceStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function readBackgroundConnectionPreference(storage: PreferenceStorage): boolean {
  return storage.getItem(BACKGROUND_CONNECTION_PREFERENCE_KEY) === 'enabled'
}

export function writeBackgroundConnectionPreference(storage: PreferenceStorage, enabled: boolean): void {
  storage.setItem(BACKGROUND_CONNECTION_PREFERENCE_KEY, enabled ? 'enabled' : 'disabled')
}

export interface BackgroundConnectionControl {
  setEnabled(enabled: boolean): Promise<void>
  subscribeWake(listener: () => void): () => void
}

export interface NativeBackgroundConnectionBridge {
  setEnabled(options: { enabled: boolean }): Promise<void>
  addListener(event: 'wake', listener: () => void): Promise<{ remove(): Promise<void> }>
}

const browserControl: BackgroundConnectionControl = {
  async setEnabled() {},
  subscribeWake() { return () => {} },
}

/** Hide native service/listener lifecycle behind one fail-soft App Shell interface. */
export function createBackgroundConnectionControl(
  bridge: NativeBackgroundConnectionBridge | null,
): BackgroundConnectionControl {
  if (bridge === null) return browserControl
  return {
    async setEnabled(enabled) {
      await bridge.setEnabled({ enabled })
    },
    subscribeWake(listener) {
      let active = true
      let handle: { remove(): Promise<void> } | undefined
      void bridge.addListener('wake', listener).then(async next => {
        if (active) handle = next
        else await next.remove()
      }).catch(() => { /* optional native wake hints must not affect transport */ })
      return () => {
        active = false
        if (handle !== undefined) void handle.remove()
      }
    },
  }
}
