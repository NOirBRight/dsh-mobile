/** Client boot-manifest adaptation for the static mobile shell.
 *
 * The tunnel reaches the one live desktop DSH profile, so its manifest owns
 * every host/API plugin. Only the root layout varies by surface: replace that
 * single row locally instead of running a second persistence-owning profile.
 */

export const DESKTOP_LAYOUT_ID = '@deepseek-ai/dsh-client-ui-layout'
export const MOBILE_LAYOUT_ID = '@dsh-mobile/ui-layout-mobile'
const CLIENT_HMR_ID = '@deepseek-ai/dsh-client-hmr'
const MOBILE_LAYOUT_REV = '0.1.0'

/** Current official rail-plus-center viability floor: 56px + 640px. */
export const NARROW_LAYOUT_BREAKPOINT = 696

/**
 * Width used to pick the exclusive root. Prefer the CSS viewport: some
 * Android WebViews report an inflated innerWidth (physical px or the 980px
 * fallback) before or instead of honoring width=device-width.
 */
export function readViewportWidth(input?: { matches?: boolean; measured?: number }): number {
  const matches = input?.matches ?? (typeof matchMedia === 'function'
    ? matchMedia('(max-width: ' + (NARROW_LAYOUT_BREAKPOINT - 1) + 'px)').matches
    : false)
  const measured = input?.measured ?? readMeasuredViewportWidth()
  if (matches && measured >= NARROW_LAYOUT_BREAKPOINT) return NARROW_LAYOUT_BREAKPOINT - 1
  return measured
}

function readMeasuredViewportWidth(): number {
  if (typeof window === 'undefined') return NARROW_LAYOUT_BREAKPOINT
  const candidates = [window.innerWidth]
  if (window.visualViewport !== null && window.visualViewport !== undefined && window.visualViewport.width > 0) {
    candidates.push(window.visualViewport.width)
  }
  if (typeof document !== 'undefined' && document.documentElement.clientWidth > 0) {
    candidates.push(document.documentElement.clientWidth)
  }
  return Math.min(...candidates)
}

export interface BootEntry {
  id: string
  url: string
  rev: string
  inject: string[]
  immediately?: boolean
  [key: string]: unknown
}

export interface BootManifest {
  rev: string
  entries: BootEntry[]
  [key: string]: unknown
}

export interface PluginLocalizationOptions {
  /** Fetch one host-owned plugin script through the authenticated direct tunnel. */
  load(url: string): Promise<string>
  /** Turn source into an executable local URL (Blob URL in Android WebView). */
  createUrl(source: string, id: string): string
}

/**
 * Replace host plugin URLs with local executable URLs. The mobile root layout
 * ships inside the Android application and is intentionally left alone.
 */
/** Host plugin scripts share one ordered tunnel; a full parallel stampede stalls heartbeat pongs. */
export const PLUGIN_LOAD_CONCURRENCY = 2

export async function localizePluginBundles(
  manifest: BootManifest,
  options: PluginLocalizationOptions,
): Promise<BootManifest> {
  const entries = await mapPool(manifest.entries, PLUGIN_LOAD_CONCURRENCY, async (entry) => {
    if (entry.id === MOBILE_LAYOUT_ID) return { ...entry }
    if (!entry.url.startsWith('/plugins/')) {
      throw new Error('host plugin URL must stay under /plugins/: ' + entry.id)
    }
    const source = await options.load(entry.url)
    return { ...entry, url: options.createUrl(source, entry.id) }
  })
  return { ...manifest, entries }
}

async function mapPool<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  async function worker(): Promise<void> {
    for (;;) {
      const index = next
      next += 1
      if (index >= items.length) return
      results[index] = await fn(items[index])
    }
  }
  const workers = Math.min(Math.max(1, limit), Math.max(items.length, 1))
  await Promise.all(Array.from({ length: items.length === 0 ? 0 : workers }, () => worker()))
  return results
}

export type SameOriginFetch = (
  input: string,
  init: { credentials: 'same-origin'; cache: 'no-store' },
) => Promise<Response>

/**
 * Probe an operator-provided same-origin Host bridge and derive its mobile
 * roster. A missing bridge is not an error: public static shells fall back to
 * their paired tunnel instead. Other failures are surfaced rather than booting
 * an empty AppWebEntry without a manifest.
 */
export async function loadSameOriginMobileBootManifest(
  fetcher: SameOriginFetch = fetch,
): Promise<BootManifest | null> {
  const response = await fetcher('/__dsh_boot', { credentials: 'same-origin', cache: 'no-store' })
  if (response.status === 404) return null
  if (!response.ok) throw new Error('same-origin boot manifest fetch failed: HTTP ' + response.status)
  if (response.headers.get('x-dsh-host-bridge') !== '1') return null

  return validateBootManifest(extractBootManifestJson(await response.text(), 'boot manifest not found in same-origin Host index'))
}

export function extractBootManifestJson(html: string, missing = 'boot manifest not found'): unknown {
  const match = /window\.__DSH_BOOT__ = (\{.*?\})<\/script>/s.exec(html)
  if (match === null) throw new Error(missing)
  return JSON.parse(match[1])
}

const NARROW_LAYOUT_DEPENDENCIES = ['@deepseek-ai/dsh-client-runtime', '@deepseek-ai/dsh-client-ui-theme'] as const

export type LayoutCompatibility = 'compatible' | 'revision-mismatch' | 'missing-contract'
export type ResponsiveRoot = 'official' | 'narrow'

export interface ResponsiveBootSelectionOptions {
  /** Width captured before plugin boot. The caller owns observing transitions and reloading. */
  viewportWidth: number
  /** Pinned Host layout revision, when one is known; drift is visible but non-blocking. */
  expectedOfficialLayoutRevision?: string
  /** Result of the caller's narrow slot-contract capability check. */
  narrowContractAvailable?: boolean
}

export interface ResponsiveBootSelection {
  manifest: BootManifest
  layout: ResponsiveRoot
  compatibility: LayoutCompatibility
  officialLayoutRevision: string
}

function validateBootManifest(value: unknown): BootManifest {
  if (typeof value !== 'object' || value === null) throw new Error('mobile boot manifest must be an object')
  const manifest = value as Partial<BootManifest>
  if (typeof manifest.rev !== 'string' || !Array.isArray(manifest.entries)) {
    throw new Error('mobile boot manifest requires string rev and entries array')
  }
  for (const entry of manifest.entries) {
    if (
      typeof entry !== 'object' || entry === null ||
      typeof entry.id !== 'string' || typeof entry.url !== 'string' ||
      typeof entry.rev !== 'string' || !Array.isArray(entry.inject)
    ) {
      throw new Error('mobile boot manifest contains an invalid entry')
    }
  }
  const layouts = manifest.entries.filter(entry => entry.id === DESKTOP_LAYOUT_ID)
  if (layouts.length !== 1) {
    throw new Error('mobile boot manifest expected exactly one desktop layout entry, found ' + layouts.length)
  }
  return manifest as BootManifest
}

/**
 * Select exactly one root before plugin boot. This function has no viewport or
 * reload side effects: callers compare the returned layout after resize and
 * perform their own controlled reload when it changes.
 */
export function selectResponsiveBootManifest(
  value: unknown,
  options: ResponsiveBootSelectionOptions,
): ResponsiveBootSelection {
  const manifest = validateBootManifest(value)
  const official = manifest.entries.find(entry => entry.id === DESKTOP_LAYOUT_ID)!
  const hostEntries = manifest.entries.filter(entry => entry.id !== CLIENT_HMR_ID)
  const wantsNarrow = options.viewportWidth < NARROW_LAYOUT_BREAKPOINT
  const contractAvailable = options.narrowContractAvailable !== false
  const revisionMismatch = options.expectedOfficialLayoutRevision !== undefined &&
    options.expectedOfficialLayoutRevision !== official.rev

  if (!wantsNarrow || !contractAvailable) {
    return {
      manifest: { ...manifest, entries: hostEntries },
      layout: 'official',
      compatibility: wantsNarrow && !contractAvailable ? 'missing-contract' : 'compatible',
      officialLayoutRevision: official.rev,
    }
  }

  const mobileLayout: BootEntry = {
    id: MOBILE_LAYOUT_ID,
    url: '/plugins/@dsh-mobile/ui-layout-mobile/client.js?rev=' + MOBILE_LAYOUT_REV,
    rev: MOBILE_LAYOUT_REV,
    inject: ['@deepseek-ai/dsh-client-runtime', '@deepseek-ai/dsh-client-ui-theme'],
  }
  return {
    manifest: {
      ...manifest,
      rev: manifest.rev + '+mobile-layout-' + MOBILE_LAYOUT_REV,
      entries: hostEntries.map(entry => entry.id === DESKTOP_LAYOUT_ID ? mobileLayout : { ...entry }),
    },
    layout: 'narrow',
    compatibility: revisionMismatch ? 'revision-mismatch' : 'compatible',
    officialLayoutRevision: official.rev,
  }
}

/** True when the official root still provides the slot contract the narrow adapter needs. */
export function officialNarrowContractAvailable(value: unknown): boolean {
  try {
    const manifest = validateBootManifest(value)
    const official = manifest.entries.find(entry => entry.id === DESKTOP_LAYOUT_ID)
    if (official === undefined) return false
    const provided = new Set([...official.inject, ...manifest.entries.map(entry => entry.id)])
    return NARROW_LAYOUT_DEPENDENCIES.every(id => provided.has(id))
  } catch {
    return false
  }
}

export function layoutCompatibilityMessage(compatibility: LayoutCompatibility): string | null {
  if (compatibility === 'revision-mismatch') return 'Host 布局版本有更新。窄屏布局仍会继续使用。'
  if (compatibility === 'missing-contract') return '窄屏布局无法安全挂载，已回退到官方布局。'
  return null
}

export function installCompatibilityNotice(compatibility: LayoutCompatibility): void {
  const message = layoutCompatibilityMessage(compatibility)
  if (message === null || typeof document === 'undefined') return
  const bar = document.createElement('div')
  bar.setAttribute('role', 'status')
  bar.style.cssText = 'position:sticky;top:0;z-index:10001;padding:8px 12px;background:#854d0e;color:#fff;font:13px/1.4 system-ui,sans-serif;display:flex;justify-content:space-between;align-items:center;gap:12px'
  const text = document.createElement('span')
  text.textContent = message
  const close = document.createElement('button')
  close.type = 'button'
  close.textContent = 'Dismiss'
  close.setAttribute('aria-label', 'Dismiss')
  close.style.cssText = 'border:0;background:transparent;color:inherit;font:inherit;cursor:pointer'
  close.onclick = () => bar.remove()
  bar.append(text, close)
  document.body.prepend(bar)
}

/** Transitional narrow-only adapter retained for current callers. */
export function adaptBootManifestForMobile(value: unknown): BootManifest {
  return selectResponsiveBootManifest(value, { viewportWidth: 0 }).manifest
}
