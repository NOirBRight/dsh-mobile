/** App Shell-only native capabilities. Host UI modules must not receive these. */
import { Capacitor, registerPlugin } from '@capacitor/core'
import type { NativeCredentialVaultBridge } from './credential-vault.ts'
import type { NativeBackgroundConnectionBridge } from './background-connection.ts'

export const SHELL_NATIVE_PLUGIN_NAMES = [
  'DshSecureVault',
  'DshCameraPermission',
  'DshSystemBars',
  'DshBackgroundConnection',
  'CapacitorBarcodeScanner',
  'App',
] as const

interface NativeCameraPermissionBridge {
  ensure(): Promise<void>
}

export interface NativeSystemBarsBridge {
  setAppearance(options: { dark: boolean }): Promise<void>
}

export interface ShellNativeBridges {
  vault: NativeCredentialVaultBridge | null
  systemBars: NativeSystemBarsBridge | null
  backgroundConnection: NativeBackgroundConnectionBridge | null
  ensureCamera(): Promise<void>
}

interface CapacitorPluginRegistry {
  Plugins?: Record<string, unknown>
  registerPlugin?: ((name: string, implementations?: unknown) => unknown) & { __dshShellGuard?: boolean }
}

const unavailable = (capability: string) => async (): Promise<never> => {
  throw new Error(capability + ' is reserved for the App Shell')
}

let claimed: ShellNativeBridges | null = null

export function claimedNativeBridges(): ShellNativeBridges {
  if (claimed === null) throw new Error('native bridges have not been claimed by the App Shell')
  return claimed
}

/** Take private plugin proxies, then remove them from the public Capacitor table. */
export function claimShellNativeBridges(native: boolean): ShellNativeBridges {
  if (!native) {
    claimed = { vault: null, systemBars: null, backgroundConnection: null, ensureCamera: unavailable('camera') }
    concealShellNativeBridges()
    return claimed
  }
  const vault = registerPlugin<NativeCredentialVaultBridge>('DshSecureVault')
  const camera = registerPlugin<NativeCameraPermissionBridge>('DshCameraPermission')
  const systemBars = registerPlugin<NativeSystemBarsBridge>('DshSystemBars')
  const backgroundConnection = registerPlugin<NativeBackgroundConnectionBridge>('DshBackgroundConnection')
  claimed = { vault, systemBars, backgroundConnection, ensureCamera: () => camera.ensure() }
  concealShellNativeBridges()
  return claimed
}

/** Keep Android system-bar icon contrast aligned with the theme presenter. */
export function installSystemBarThemeSync(bridge: NativeSystemBarsBridge | null): () => void {
  if (bridge === null || typeof document === 'undefined' || document.body === null || typeof MutationObserver === 'undefined') return () => {}
  let lastDark: boolean | undefined
  const sync = (): void => {
    const dark = document.body.hasAttribute('data-ds-dark-theme')
    if (lastDark === dark) return
    lastDark = dark
    void Promise.resolve()
      .then(() => bridge.setAppearance({ dark }))
      .catch(() => {
        // System-bar appearance is best effort; the Web theme remains authoritative.
      })
  }
  const observer = new MutationObserver(sync)
  observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
  sync()
  return () => observer.disconnect()
}

/** Drop shell-private names from Capacitor.Plugins and refuse public re-registration. */
export function concealShellNativeBridges(): void {
  const cap = Capacitor as unknown as CapacitorPluginRegistry
  if (cap.Plugins !== undefined) {
    for (const name of SHELL_NATIVE_PLUGIN_NAMES) delete cap.Plugins[name]
  }
  const original = cap.registerPlugin
  if (original === undefined || original.__dshShellGuard === true) return
  const guarded = ((name: string, implementations?: unknown) => {
    if ((SHELL_NATIVE_PLUGIN_NAMES as readonly string[]).includes(name)) {
      throw new Error('native capability is reserved for the App Shell')
    }
    return original(name, implementations)
  }) as NonNullable<CapacitorPluginRegistry['registerPlugin']>
  guarded.__dshShellGuard = true
  cap.registerPlugin = guarded
}
