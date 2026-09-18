/**
 * Vite transform: append alpha.2 `isDarwinDesktop` onto the **seeded**
 * ui-primitives barrel. Missing seam: 0.1.5 primitives omit it, and Host
 * ui-sidebar SidebarRoot calls it on every render — an undefined export
 * throws, the slot error boundary paints an empty crash face, and the
 * mobile drawer looks blank. Not a patch of `.dsh-upstream` or DSH core.
 */
import type { Plugin } from 'vite'

/**
 * True when this file is the ui-primitives public barrel.
 * @param id - Vite module id, possibly with query.
 */
export function isPrimitivesIndexModule(id: string): boolean {
  return id.split('?')[0].replace(/\\/g, '/').endsWith('/ui-primitives/src/index.ts')
}

/**
 * Append the darwin-desktop export when the upstream barrel omits it.
 * @param code - current module source.
 * @param darwinModule - absolute path of darwin-desktop.ts.
 * @returns patched source, or null when no change is needed.
 */
export function patchPrimitivesIndex(code: string, darwinModule: string): string | null {
  if (code.includes('isDarwinDesktop')) return null
  return `${code}\nexport { isDarwinDesktop } from ${JSON.stringify(darwinModule)}\n`
}

/**
 * Seed `isDarwinDesktop` into the shell primitives table.
 * @param darwinModule - absolute path of darwin-desktop.ts.
 */
export function attachDarwinDesktop(darwinModule: string): Plugin {
  return {
    name: 'dsh-darwin-desktop',
    transform(code, id) {
      if (!isPrimitivesIndexModule(id)) return
      const next = patchPrimitivesIndex(code, darwinModule)
      if (next === null) return
      return { code: next, map: null }
    },
  }
}
