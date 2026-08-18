/** App Shell-only native capabilities. Host UI modules must not receive these. */
import { Capacitor, registerPlugin } from '@capacitor/core'
import type { NativeCredentialVaultBridge } from './credential-vault.ts'

export const SHELL_NATIVE_PLUGIN_NAMES = [
  'DshSecureVault',
  'DshCameraPermission',
  'CapacitorBarcodeScanner',
  'App',
] as const

interface NativeCameraPermissionBridge {
  ensure(): Promise<void>
}

export interface ShellNativeBridges {
  vault: NativeCredentialVaultBridge | null
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
    claimed = { vault: null, ensureCamera: unavailable('camera') }
    concealShellNativeBridges()
    return claimed
  }
  const vault = registerPlugin<NativeCredentialVaultBridge>('DshSecureVault')
  const camera = registerPlugin<NativeCameraPermissionBridge>('DshCameraPermission')
  claimed = { vault, ensureCamera: () => camera.ensure() }
  concealShellNativeBridges()
  return claimed
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
