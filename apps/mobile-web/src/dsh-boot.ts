/** DSH AppWebEntry / ClientModuleSystem boot protocol for a static shell. */
import type { BootManifest } from './manifest.ts'

interface ClientBundleRegistration {
  id: string
  factory(require: (specifier: string) => unknown): Record<string, unknown>
}

interface QueueModuleLoader {
  mode: 'queue'
  pendingQueue: ClientBundleRegistration[]
  load(registration: ClientBundleRegistration): void
  create(options: unknown): unknown
}

interface DshBootWindow {
  __ModuleLoader__?: QueueModuleLoader | unknown
  __DSH_MODULES__?: unknown
}

const PARSER_PRELOAD_IDS = [
  '@deepseek-ai/dsh-client-modules',
] as const

/** Uninstall boot-once globals so a later AppWebEntry can run in this document. */
export function resetDshClientBoot(): void {
  const win = globalThis as typeof globalThis & DshBootWindow
  delete win.__ModuleLoader__
  delete win.__DSH_MODULES__
}

/** Official queue facade installed by Host HTML before parser-preload scripts. */
export function installDshModuleLoaderQueue(): QueueModuleLoader {
  const pendingQueue: ClientBundleRegistration[] = []
  const target: QueueModuleLoader = {
    mode: 'queue',
    pendingQueue,
    load(registration) { pendingQueue.push(registration) },
    create(options) {
      if (this.mode !== 'queue') {
        throw new Error('client-modules: window.__ModuleLoader__.create called after module-system boot')
      }
      const index = pendingQueue.findIndex(registration => registration.id === '@deepseek-ai/dsh-client-modules')
      const registration = pendingQueue[index]
      if (registration === undefined) {
        throw new Error('client-modules: HTML did not preload @deepseek-ai/dsh-client-modules/client.js')
      }
      pendingQueue.splice(index, 1)
      const exports = registration.factory((specifier) => {
        throw new Error('client-modules: bootstrap requested external "' + specifier + '" before the module system existed')
      })
      if (
        typeof exports !== 'object' || exports === null
        || typeof exports.createClientModuleSystem !== 'function'
        || typeof exports.apply !== 'function'
      ) {
        throw new Error('client-modules: bootstrap bundle did not export the module face')
      }
      return (exports.createClientModuleSystem as (
        facade: QueueModuleLoader,
        bootstrap: { id: string; exports: Record<string, unknown> },
        options: unknown,
      ) => unknown)(this, { id: registration.id, exports }, options)
    },
  }
  ;(globalThis as typeof globalThis & DshBootWindow).__ModuleLoader__ = target
  return target
}

export type BootScriptLoader = (url: string, id: string) => Promise<void>

/**
 * Reset the prior client module system, install the official queue facade, and
 * execute the two parser-preload bundles before AppWebEntry reads the graph.
 */
export async function prepareDshClientBoot(
  manifest: BootManifest,
  loadScript: BootScriptLoader = loadClassicScript,
): Promise<void> {
  resetDshClientBoot()
  installDshModuleLoaderQueue()
  for (const id of PARSER_PRELOAD_IDS) {
    const entry = manifest.entries.find(candidate => candidate.id === id)
    if (entry === undefined) throw new Error('mobile shell: boot manifest missing parser preload ' + id)
    await loadScript(entry.url, id)
  }
}

async function loadClassicScript(url: string, id: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = url
    script.async = false
    script.dataset.dshPreload = id
    script.onload = () => { script.remove(); resolve() }
    script.onerror = () => { script.remove(); reject(new Error('mobile shell: failed parser preload ' + id)) }
    document.head.append(script)
  })
}
