/** Client boot-manifest adaptation for the static mobile shell.
 *
 * The tunnel reaches the one live desktop DSH profile, so its manifest owns
 * every host/API plugin. Only the root layout varies by surface: replace that
 * single row locally instead of running a second persistence-owning profile.
 */

export const DESKTOP_LAYOUT_ID = '@deepseek-ai/dsh-client-ui-layout'
export const MOBILE_LAYOUT_ID = '@dsh-mobile/ui-layout-mobile'
export const CONNECTION_ID = '@deepseek-ai/dsh-client-connection'
export const DSH_HOST_BRIDGE_CAPABILITY = '__DSH_HOST_BRIDGE__'
const CLIENT_HMR_ID = '@deepseek-ai/dsh-client-hmr'
const MOBILE_LAYOUT_REV = '0.1.23'
const MOBILE_CONNECTION_REV = '0.1.23'
const MOBILE_CONNECTION_URL = '/plugins/@dsh-mobile/ui-layout-mobile/connection.js?rev=' + MOBILE_CONNECTION_REV

/** Mark the page only after the authenticated same-origin Host bridge is validated. */
export function setSameOriginHostBridgeCapability(enabled: boolean): void {
  const scope = globalThis as typeof globalThis & Record<string, unknown>
  if (enabled) scope[DSH_HOST_BRIDGE_CAPABILITY] = { loopback: true }
  else delete scope[DSH_HOST_BRIDGE_CAPABILITY]
}

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
  /** Fetch one host-owned plugin script through the authenticated Host tunnel. */
  load(url: string): Promise<string>
  /** Turn source into an executable local URL (Blob URL in Android WebView). */
  createUrl(source: string, id: string): string
  /** Optional content-addressed cache keyed by plugin id + revision. */
  cache?: PluginBundleCache
  /** When true, a cache miss fails instead of calling load — used for offline hydrate. */
  cacheOnly?: boolean
}

export interface PluginBundleCache {
  read(id: string, rev: string): Promise<string | undefined>
  write(id: string, rev: string, source: string): Promise<void>
}

const PLUGIN_CACHE_PREFIX = 'dsh-mobile:plugin:'

/** Stored values: 'gz1:' + base64(gzip(source)), or legacy plaintext. */
const GZIP_PREFIX = 'gz1:'

/** The WebView localStorage origin is hard-capped at 5 MB; bundles gzip ~3.5x. */
const gzipCapable = (): boolean => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function'

async function gzipEncode(source: string): Promise<string> {
  const compressed = await new Response(
    new Blob([source]).stream().pipeThrough(new CompressionStream('gzip')),
  ).arrayBuffer()
  const bytes = new Uint8Array(compressed)
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return GZIP_PREFIX + btoa(binary)
}

async function gzipDecode(stored: string): Promise<string> {
  const binary = atob(stored.slice(GZIP_PREFIX.length))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return new Response(
    new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),
  ).text()
}

async function decodeStored(stored: string | null): Promise<string | undefined> {
  if (stored === null || stored === undefined) return undefined
  if (stored.startsWith(GZIP_PREFIX)) return gzipDecode(stored)
  return stored
}

export function createMemoryPluginCache(hostId = ''): PluginBundleCache {
  const records = new Map<string, string>()
  const scope = hostId + '\0'
  return {
    async read(id, rev) { return records.get(scope + id + '\0' + rev) },
    async write(id, rev, source) { records.set(scope + id + '\0' + rev, source) },
  }
}

export function createLocalStoragePluginCache(storage?: Pick<Storage, 'getItem' | 'setItem'> | null, hostId = ''): PluginBundleCache | undefined {
  let resolved = storage
  if (resolved === undefined) {
    try { resolved = globalThis.localStorage } catch { resolved = undefined }
  }
  if (resolved === undefined || resolved === null) return undefined
  const scope = PLUGIN_CACHE_PREFIX + hostId + ':'
  return {
    async read(id, rev) {
      try {
        const key = resolved.getItem(scope + id + ':' + rev) !== null
          ? scope + id + ':' + rev
          : resolved.getItem(PLUGIN_CACHE_PREFIX + 'latest:' + id) !== null
            ? PLUGIN_CACHE_PREFIX + 'latest:' + id
            : PLUGIN_CACHE_PREFIX + id + ':' + rev
        const stored = resolved.getItem(key)
        const decoded = await decodeStored(stored)
        // Read-through migration: legacy plaintext entries converge to gzip.
        if (decoded !== undefined && gzipCapable() && stored !== null && !stored.startsWith(GZIP_PREFIX)) {
          void gzipEncode(decoded)
            // eslint-disable-next-line promise/no-catch-in-promise -- migration is best-effort only
            .then(value => { try { resolved.setItem(key, value) } catch { /* quota pressure: migration can wait */ } })
            .catch(() => { /* decode races are harmless */ })
        }
        return decoded
      } catch {
        return undefined
      }
    },
    async write(id, rev, source) {
      const target = scope + id + ':' + rev
      const value = gzipCapable() ? await gzipEncode(source) : source
      const attempt = (): void => {
        // Keep exactly one generation per plugin: an older scoped copy of the
        // same id would otherwise strand the origin at quota permanently.
        const prefix = scope + id + ':'
        const victims: string[] = []
        const store = resolved as unknown as Pick<Storage, 'getItem' | 'setItem'> & EvictableStorage
        const count = store.length ?? 0
        for (let index = 0; index < count; index++) {
          const key = store.key ? store.key(index) : null
          if (key !== null && key !== undefined && key !== target && key.startsWith(prefix)) victims.push(key)
        }
        for (const key of victims) {
          if (store.removeItem) store.removeItem(key)
        }
        resolved.setItem(target, value)
      }
      try {
        attempt()
      } catch {
        // Quota pressure: shed superseded / foreign cached bundles and retry once.
        // Session-history caches never appear on the victim list: history is
        // the user-facing cold-start value, plugin bundles re-download anyway.
        evictMobileCaches(resolved as unknown as EvictableStorage, value.length + 4096)
        try { attempt() } catch { /* private mode or an unevictable origin */ }
      }
    },
  }
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
    if (entry.id === CONNECTION_ID && entry.url.startsWith('/plugins/@dsh-mobile/ui-layout-mobile/connection.js')) return { ...entry }
    if (!entry.url.startsWith('/plugins/')) {
      throw new Error('host plugin URL must stay under /plugins/: ' + entry.id)
    }
    let source = await options.cache?.read(entry.id, entry.rev)
    if (source === undefined) {
      if (options.cacheOnly === true) throw new Error('plugin cache miss: ' + entry.id)
      source = await options.load(entry.url)
      await options.cache?.write(entry.id, entry.rev, source)
    }
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

  const manifest = validateBootManifest(extractBootManifestJson(await response.text(), 'boot manifest not found in same-origin Host index'))
  return {
    ...manifest,
    entries: manifest.entries.map(entry => entry.id === CONNECTION_ID
      ? { ...entry, url: MOBILE_CONNECTION_URL, rev: MOBILE_CONNECTION_REV }
      : { ...entry }),
  }
}

/** Host index embeddings seen in the wild: `window.` (legacy) and `globalThis` (dot + bracket) forms. */
const BOOT_MANIFEST_SCRIPT = /(?:window|globalThis)(?:\.|\[["'])__DSH_BOOT__(?:["']\]|\.)?\s*=\s*(\{.*?\})<\/script>/s

export function extractBootManifestJson(html: string, missing = 'boot manifest not found'): unknown {
  const match = BOOT_MANIFEST_SCRIPT.exec(html)
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

const BOOT_CACHE_PREFIX = 'dsh-mobile:boot:'
const LAST_BOOT_CACHE_ID = 'last'

/**
 * Scope of the Active Host's plugin entries ('<hostId>:'). These are the
 * copies offline cold-start hydrate depends on, so eviction sheds them last.
 */
let PROTECTED_PLUGIN_SCOPE = ''

/** Pin the Active Host scope that cache eviction must never shed early. */
export function setProtectedCacheScope(hostId: string): void {
  PROTECTED_PLUGIN_SCOPE = hostId
}

type EvictableStorage = {
  getItem(key: string): string | null
  removeItem?(key: string): void
  length?: number
  key?(index: number): string | null
}

/**
 * Eviction ranking for cached plugin records (lower sheds first):
 *  0 — legacy unscoped plugin copies superseded by the 'latest:' pointer
 *  1 — per-Host 'latest:' duplicates of the global 'latest:' pointer
 *  2 — other-Host scoped exact bundles
 *  4 — Active-Host scoped exact bundles (last resort)
 * Boot rosters are never evictable: they gate the offline cold start.
 */
function cacheEvictionRank(key: string): number {
  const rest = key.slice(PLUGIN_CACHE_PREFIX.length)
  const parts = rest.split(':')
  if (parts[1] === 'latest') return 1
  if (parts.length >= 3) return parts[0] === PROTECTED_PLUGIN_SCOPE ? 4 : 2
  return 0
}

/**
 * Free space by dropping redundant / re-downloadable plugin cache entries.
 * Only records ranked up to maxRank are candidates. Returns the approximate
 * number of characters freed.
 */
function evictMobileCaches(storage: EvictableStorage, bytesNeeded: number, maxRank = 4): number {
  if (typeof storage.removeItem !== 'function') return 0
  const entries: { key: string; size: number; rank: number }[] = []
  try {
    const count = storage.length ?? 0
    for (let index = 0; index < count; index++) {
      const key = storage.key?.(index)
      if (key === null || key === undefined) continue
      if (!key.startsWith(PLUGIN_CACHE_PREFIX)) continue
      const rank = cacheEvictionRank(key)
      if (rank > maxRank) continue
      entries.push({ key, size: storage.getItem(key)?.length ?? 0, rank })
    }
  } catch {
    return 0
  }
  entries.sort((left, right) => left.rank - right.rank || right.size - left.size)
  let freed = 0
  for (const entry of entries) {
    if (freed >= bytesNeeded) break
    try {
      storage.removeItem(entry.key)
      freed += entry.size
    } catch { /* keep evicting the remaining candidates */ }
  }
  return freed
}

/**
 * Shed superseded duplicate generations (legacy copies and per-Host 'latest'
 * duplicates) so the origin keeps standing headroom for session history.
 */
export function pruneRedundantCaches(storage?: Pick<Storage, 'getItem' | 'setItem'> | null): void {
  const resolved = resolveStorage(storage as Pick<Storage, 'getItem' | 'setItem'> | null | undefined)
  if (resolved === undefined) return
  evictMobileCaches(resolved as unknown as EvictableStorage, Number.MAX_SAFE_INTEGER, 2)
}

/** Persist the last successful unlocalized Host boot roster for one Host Identity. */
export function readCachedBootManifest(
  hostId: string,
  storage?: Pick<Storage, 'getItem'> | null,
): BootManifest | undefined {
  const resolved = resolveStorage(storage)
  if (resolved === undefined) return undefined
  try {
    const raw = resolved.getItem(BOOT_CACHE_PREFIX + hostId)
    if (raw === null) return undefined
    return validateBootManifest(JSON.parse(raw))
  } catch {
    return undefined
  }
}

export function writeCachedBootManifest(
  hostId: string,
  manifest: BootManifest,
  storage?: Pick<Storage, 'setItem'> | null,
): void {
  const resolved = resolveStorage(storage as Pick<Storage, 'getItem' | 'setItem'> | null | undefined)
  if (resolved === undefined) return
  if (typeof resolved.setItem !== 'function') return
  const raw = JSON.stringify(manifest)
  try {
    resolved.setItem(BOOT_CACHE_PREFIX + hostId, raw)
    resolved.setItem(BOOT_CACHE_PREFIX + LAST_BOOT_CACHE_ID, raw)
    pruneRedundantCaches(resolved as Pick<Storage, 'getItem' | 'setItem'>)
  } catch {
    // Quota pressure: shed re-downloadable cache entries and retry once so the
    // offline cold-start roster always survives.
    evictMobileCaches(resolved as unknown as EvictableStorage, raw.length * 2 + 4096)
    try {
      resolved.setItem(BOOT_CACHE_PREFIX + hostId, raw)
      resolved.setItem(BOOT_CACHE_PREFIX + LAST_BOOT_CACHE_ID, raw)
    } catch { /* private mode or an unevictable origin */ }
  }
}

function resolveStorage(storage?: Pick<Storage, 'getItem' | 'setItem'> | Pick<Storage, 'getItem'> | null): (Pick<Storage, 'getItem'> & Partial<Pick<Storage, 'setItem'>>) | undefined {
  if (storage === undefined) {
    try { return globalThis.localStorage } catch { return undefined }
  }
  return storage ?? undefined
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
      entries: hostEntries.map(entry => {
        if (entry.id === DESKTOP_LAYOUT_ID) return mobileLayout
        if (entry.id === CONNECTION_ID) return { ...entry, url: MOBILE_CONNECTION_URL, rev: MOBILE_CONNECTION_REV }
        return { ...entry }
      }),
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
  // The notice is prepended before the mobile shell; reserve the Android
  // status-bar inset so system icons never cover its text.
  bar.style.cssText = 'position:sticky;top:0;z-index:10001;box-sizing:border-box;padding:calc(6px + env(safe-area-inset-top)) 12px 6px;background:var(--dsw-alias-bg-base,Canvas);color:var(--dsw-alias-label-primary,CanvasText);border-bottom:1px solid var(--dsw-alias-border-l1,ButtonBorder);font:13px/1.4 system-ui,sans-serif;display:flex;justify-content:space-between;align-items:center;gap:8px'
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
