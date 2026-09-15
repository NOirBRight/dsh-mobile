/**
 * Vite transform: append Host 0.1.6 HOST_FACES glyphs onto an older
 * ui-primitives icons module. Used by apps/mobile-web/vite.config.ts.
 */
import type { Plugin } from 'vite'

const HOST_FACE_EXPORTS = [
  'IconPlanOutline14',
  'IconPaperPlaneOutline14',
  'IconCompactOutline16',
  'IconShieldOutline16',
] as const

/**
 * True when this file is the ui-primitives icons barrel.
 * @param id - Vite module id, possibly with query.
 */
export function isPrimitivesIconsModule(id: string): boolean {
  return id.split('?')[0].replace(/\\/g, '/').endsWith('/ui-primitives/src/icons/index.tsx')
}

/**
 * Append the four Host-face exports when the upstream barrel omits them.
 * @param code - current module source.
 * @param iconsModule - absolute path of host-command-icons.tsx.
 * @returns patched source, or null when no change is needed.
 */
export function patchPrimitivesIcons(code: string, iconsModule: string): string | null {
  if (code.includes('export const IconPlanOutline14')) return null
  return `${code}\nexport {\n  ${HOST_FACE_EXPORTS.join(',\n  ')},\n} from ${JSON.stringify(iconsModule)}\n`
}

/**
 * Seed the missing 0.1.6 HOST_FACES glyphs into the shell primitives table.
 * @param iconsModule - absolute path of host-command-icons.tsx.
 */
export function attachHostCommandIcons(iconsModule: string): Plugin {
  return {
    name: 'dsh-host-command-icons',
    transform(code, id) {
      if (!isPrimitivesIconsModule(id)) return
      const next = patchPrimitivesIcons(code, iconsModule)
      if (next === null) return
      return { code: next, map: null }
    },
  }
}
