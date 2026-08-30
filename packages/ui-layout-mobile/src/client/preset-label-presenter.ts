/** Mobile-only compact copy for the four shipped agent presets. */

export const BUILT_IN_PRESET_IDS = ['standard', 'ptc', 'minimal', 'cordis'] as const
export type BuiltInPresetId = (typeof BUILT_IN_PRESET_IDS)[number]
export type CompactPresetLocale = 'zh' | 'en'

/**
 * Visible names and ids that prove a shipped preset. Official Web copy is the
 * recognition set; compact mobile words are owned here so CSS never hardcodes them.
 */
const BUILT_IN_PRESET_ALIASES: Readonly<Record<BuiltInPresetId, readonly string[]>> = {
  standard: ['standard', 'Standard mode', '标准模式'],
  ptc: ['ptc', 'PTC', 'PTC mode', 'PTC 模式'],
  minimal: ['minimal', 'Minimal mode', '极简模式'],
  cordis: ['cordis', 'Creator mode', '创造模式'],
}

/** Compact header words for the active Web locale. */
export const COMPACT_PRESET_LABELS: Readonly<Record<CompactPresetLocale, Readonly<Record<BuiltInPresetId, string>>>> = {
  zh: { standard: '标准', ptc: 'PTC', minimal: '极简', cordis: '创造' },
  en: { standard: 'Standard', ptc: 'PTC', minimal: 'Minimal', cordis: 'Creator' },
}

/** Map html lang to the compact preset locale. */
export function compactPresetLocale(lang: string): CompactPresetLocale {
  return /^zh(?:-|$)/i.test(lang.trim()) ? 'zh' : 'en'
}

function isLabelSpace(ch: string): boolean {
  const code = ch.charCodeAt(0)
  return code === 32 || code === 9 || code === 10 || code === 13
}

function normalizePresetLabel(text: string): string {
  let out = ''
  let pendingSpace = false
  for (const ch of text.trim()) {
    if (isLabelSpace(ch)) {
      pendingSpace = true
      continue
    }
    if (pendingSpace && out !== '') out += ' '
    pendingSpace = false
    out += ch
  }
  return out
}

/** Identify a shipped preset from an id or official localized full name. */
export function identifyBuiltInPreset(text: string): BuiltInPresetId | null {
  const normalized = normalizePresetLabel(text)
  if (normalized === '') return null
  for (const id of BUILT_IN_PRESET_IDS) {
    if (BUILT_IN_PRESET_ALIASES[id].some(alias => alias.localeCompare(normalized, undefined, { sensitivity: 'accent' }) === 0)) {
      return id
    }
  }
  return null
}

/**
 * Compact header copy for a shipped preset. Arbitrary user names stay untouched.
 * @param text - visible label or preset id.
 * @param lang - html lang, used only to pick compact words after identity is proven.
 */
export function compactPresetLabel(text: string, lang = 'zh'): string | null {
  const id = identifyBuiltInPreset(text)
  return id === null ? null : COMPACT_PRESET_LABELS[compactPresetLocale(lang)][id]
}

function activeLang(document: Document): string {
  return document.documentElement.lang || document.documentElement.getAttribute('lang') || 'zh'
}

/** Replace only proven built-in preset text nodes; keep user names and a11y titles. */
export function installPresetLabelPresenter(document: Document = globalThis.document): () => void {
  const originals = new Map<Text, string>()
  const view = document.defaultView ?? globalThis.window
  let frame = 0

  const scan = (): void => {
    const lang = activeLang(document)
    const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node !== null) {
      const text = node as Text
      const compact = compactPresetLabel(originals.get(text) ?? text.data, lang)
      if (compact !== null) {
        if (!originals.has(text)) originals.set(text, text.data)
        if (text.data !== compact) text.data = compact
      } else if (originals.has(text)) {
        const original = originals.get(text)
        if (original !== undefined && text.isConnected) text.data = original
        originals.delete(text)
      }
      node = walker.nextNode()
    }
  }
  const runFrame = (): void => { frame = 0; scan() }
  const schedule = (): void => { if (frame === 0) frame = view.requestAnimationFrame(runFrame) }
  const observer = new MutationObserver(schedule)
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['lang'],
  })
  scan()

  return () => {
    observer.disconnect()
    if (frame !== 0) view.cancelAnimationFrame(frame)
    for (const [text, original] of originals) {
      if (text.isConnected) text.data = original
    }
    originals.clear()
  }
}
