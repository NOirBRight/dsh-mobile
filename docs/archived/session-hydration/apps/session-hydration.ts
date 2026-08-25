export interface SessionListCacheEntry {
  sessionId: string
  title?: string
  updatedAt: number
  blank: boolean
  parentSessionId?: string
  origin?: 'subagent'
  cwd?: string
  agentPreset?: string
}

export interface SessionWindowCacheSeed {
  entries: readonly { event: Record<string, unknown> }[]
  hasMore: boolean
}

export type SessionHydrationCommit =
  | { kind: 'list'; entries: readonly SessionListCacheEntry[] }
  | { kind: 'window'; sessionId: string; window: SessionWindowCacheSeed }

export interface SessionHydrationAdapterLike {
  readList(): readonly SessionListCacheEntry[] | undefined
  readWindow(sessionId: string): SessionWindowCacheSeed | undefined
  committed(change: SessionHydrationCommit): void
}

interface ListRecord {
  key: string
  kind: 'list'
  version: 2
  hostId: string
  entries: SessionListCacheEntry[]
}

interface WindowRecord {
  key: string
  kind: 'window'
  version: 2
  hostId: string
  sessionId: string
  window: SessionWindowCacheSeed
}

export interface SessionCacheDatabase {
  readList(hostId: string): Promise<unknown>
  readWindows(hostId: string): Promise<readonly unknown[]>
  writeList(record: ListRecord): Promise<void>
  writeWindow(record: WindowRecord): Promise<void>
  writeMigration(list: ListRecord, windows: readonly WindowRecord[]): Promise<void>
  close(): void
}

export interface LegacySessionStorage {
  getItem(key: string): string | null
  removeItem(key: string): void
}

export interface PrepareSessionHydrationOptions {
  hostId: string
  database?: SessionCacheDatabase
  legacyStorage?: LegacySessionStorage
  allowLegacyMigration?: boolean
  flushDelayMs?: number
}

export interface PreparedSessionHydration {
  adapter: SessionHydrationAdapterLike
  migratedLegacy: boolean
  flush(): Promise<void>
  dispose(): Promise<void>
}

const DB_NAME = 'dsh-mobile-session-cache-v2'
const DB_VERSION = 1
const RECORD_VERSION = 2 as const
const LEGACY_LIST_KEY = 'dsh-mobile:sessions-list:v1'
const LEGACY_HISTORY_PREFIX = 'dsh-mobile:history:'

export const sessionListCacheKey = (hostId: string): string =>
  `dsh-mobile:${hostId}:sessions-list:v2`
export const sessionWindowCacheKey = (hostId: string, sessionId: string): string =>
  `dsh-mobile:${hostId}:history:${sessionId}:v2`

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** Persist only durable display facts; every live-only bit starts neutral. */
function normalizeListEntry(value: unknown): SessionListCacheEntry | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.sessionId !== 'string' || value.sessionId.length === 0) return undefined
  if (typeof value.updatedAt !== 'number' || !Number.isFinite(value.updatedAt)) return undefined
  if (typeof value.blank !== 'boolean') return undefined
  const origin = value.origin === 'subagent' ? 'subagent' as const : undefined
  return {
    sessionId: value.sessionId,
    ...(optionalString(value.title) === undefined ? {} : { title: optionalString(value.title) }),
    updatedAt: value.updatedAt,
    blank: value.blank,
    ...(optionalString(value.parentSessionId) === undefined ? {} : { parentSessionId: optionalString(value.parentSessionId) }),
    ...(origin === undefined ? {} : { origin }),
    ...(optionalString(value.cwd) === undefined ? {} : { cwd: optionalString(value.cwd) }),
    ...(optionalString(value.agentPreset) === undefined ? {} : { agentPreset: optionalString(value.agentPreset) }),
  }
}

function normalizeList(entries: unknown): SessionListCacheEntry[] | undefined {
  if (!Array.isArray(entries) || entries.length > 10_000) return undefined
  const normalized: SessionListCacheEntry[] = []
  for (const entry of entries) {
    const row = normalizeListEntry(entry)
    if (row === undefined) return undefined
    normalized.push(row)
  }
  return normalized
}

function normalizeHistoryEntry(value: unknown): { event: Record<string, unknown> } | undefined {
  if (!isRecord(value) || !isRecord(value.event)) return undefined
  const event = value.event
  if (typeof event.type !== 'string' || !Number.isSafeInteger(event.seq) || (event.seq as number) < 0) return undefined
  if (typeof event.time !== 'number' || !Number.isFinite(event.time)) return undefined
  // Host-computed render intent is pagination-time only and must never become durable cache state.
  return { event }
}

function normalizeWindow(value: unknown): SessionWindowCacheSeed | undefined {
  if (!isRecord(value) || !Array.isArray(value.entries) || typeof value.hasMore !== 'boolean') return undefined
  const entries: { event: Record<string, unknown> }[] = []
  let previous = -1
  for (const raw of value.entries) {
    const entry = normalizeHistoryEntry(raw)
    if (entry === undefined) return undefined
    const seq = entry.event.seq as number
    if (seq <= previous) return undefined
    previous = seq
    entries.push(entry)
  }
  return { entries, hasMore: value.hasMore }
}

function readListRecord(raw: unknown, hostId: string): SessionListCacheEntry[] | undefined {
  if (!isRecord(raw) || raw.version !== RECORD_VERSION || raw.kind !== 'list' || raw.hostId !== hostId) return undefined
  if (raw.key !== sessionListCacheKey(hostId)) return undefined
  return normalizeList(raw.entries)
}

function readWindowRecord(raw: unknown, hostId: string): { sessionId: string; window: SessionWindowCacheSeed } | undefined {
  if (!isRecord(raw) || raw.version !== RECORD_VERSION || raw.kind !== 'window' || raw.hostId !== hostId) return undefined
  if (typeof raw.sessionId !== 'string' || raw.key !== sessionWindowCacheKey(hostId, raw.sessionId)) return undefined
  const window = normalizeWindow(raw.window)
  return window === undefined ? undefined : { sessionId: raw.sessionId, window }
}

function parseLegacyList(storage: LegacySessionStorage): SessionListCacheEntry[] | undefined {
  try {
    const raw = storage.getItem(LEGACY_LIST_KEY)
    if (raw === null) return undefined
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed) || parsed.version !== 1) return undefined
    return normalizeList(parsed.entries)
  } catch { return undefined }
}

function parseLegacyWindow(storage: LegacySessionStorage, sessionId: string): SessionWindowCacheSeed | undefined {
  try {
    const raw = storage.getItem(LEGACY_HISTORY_PREFIX + sessionId)
    if (raw === null) return undefined
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.events) || !Array.isArray(parsed.views)) return undefined
    const events = parsed.events
    const views = parsed.views
    const entries = events.map((event, index) => ({
      event,
      ...(views[index] === null || views[index] === undefined ? {} : { view: views[index] }),
    }))
    return normalizeWindow({ entries, hasMore: parsed.hasMore === true })
  } catch { return undefined }
}

class MobileSessionHydrationAdapter implements SessionHydrationAdapterLike {
  private readonly hostId: string
  private readonly database: SessionCacheDatabase
  private readonly flushDelayMs: number
  private list: readonly SessionListCacheEntry[] | undefined
  private readonly windows: Map<string, SessionWindowCacheSeed>
  private pendingList: ListRecord | undefined
  private readonly pendingWindows = new Map<string, WindowRecord>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private writes = Promise.resolve()
  private disposed = false

  constructor(
    hostId: string,
    database: SessionCacheDatabase,
    list: readonly SessionListCacheEntry[] | undefined,
    windows: Map<string, SessionWindowCacheSeed>,
    flushDelayMs: number,
  ) {
    this.hostId = hostId
    this.database = database
    this.list = list
    this.windows = windows
    this.flushDelayMs = flushDelayMs
  }

  readList(): readonly SessionListCacheEntry[] | undefined { return this.list }
  readWindow(sessionId: string): SessionWindowCacheSeed | undefined { return this.windows.get(sessionId) }

  committed(change: SessionHydrationCommit): void {
    if (this.disposed) return
    if (change.kind === 'list') {
      const entries = normalizeList(change.entries)
      if (entries === undefined) return
      this.list = entries
      this.pendingList = {
        key: sessionListCacheKey(this.hostId), kind: 'list', version: RECORD_VERSION,
        hostId: this.hostId, entries,
      }
    } else {
      const window = normalizeWindow(change.window)
      if (window === undefined) return
      this.windows.set(change.sessionId, window)
      this.pendingWindows.set(change.sessionId, {
        key: sessionWindowCacheKey(this.hostId, change.sessionId), kind: 'window', version: RECORD_VERSION,
        hostId: this.hostId, sessionId: change.sessionId, window,
      })
    }
    if (this.timer === undefined) this.timer = setTimeout(() => { void this.flush() }, this.flushDelayMs)
  }

  async flush(): Promise<void> {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    const list = this.pendingList
    this.pendingList = undefined
    const windows = [...this.pendingWindows.values()]
    this.pendingWindows.clear()
    if (list === undefined && windows.length === 0) return this.writes
    this.writes = this.writes.then(async () => {
      if (list !== undefined) await this.database.writeList(list)
      for (const window of windows) await this.database.writeWindow(window)
    }).catch(() => {
      // Retain failed writes for the next flush without replacing newer authoritative commits.
      if (list !== undefined && this.pendingList === undefined) this.pendingList = list
      for (const window of windows) {
        if (!this.pendingWindows.has(window.sessionId)) this.pendingWindows.set(window.sessionId, window)
      }
    })
    await this.writes
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    await this.flush()
    this.disposed = true
    this.database.close()
  }
}

const unavailableDatabase: SessionCacheDatabase = {
  async readList() { return undefined },
  async readWindows() { return [] },
  async writeList() {},
  async writeWindow() {},
  async writeMigration() {},
  close() {},
}

export async function prepareSessionHydration(options: PrepareSessionHydrationOptions): Promise<PreparedSessionHydration> {
  const database = options.database ?? await IndexedDbSessionCacheDatabase.open().catch(() => unavailableDatabase)
  let list: readonly SessionListCacheEntry[] | undefined
  const windows = new Map<string, SessionWindowCacheSeed>()
  try { list = readListRecord(await database.readList(options.hostId), options.hostId) } catch { list = undefined }
  try {
    for (const raw of await database.readWindows(options.hostId)) {
      const record = readWindowRecord(raw, options.hostId)
      if (record !== undefined) windows.set(record.sessionId, record.window)
    }
  } catch { /* empty cold seed */ }

  let migratedLegacy = false
  const legacy = options.legacyStorage
  if (list === undefined && options.allowLegacyMigration === true && legacy !== undefined) {
    const legacyList = parseLegacyList(legacy)
    if (legacyList !== undefined) {
      const listRecord: ListRecord = {
        key: sessionListCacheKey(options.hostId), kind: 'list', version: RECORD_VERSION,
        hostId: options.hostId, entries: legacyList,
      }
      const migratedWindows: WindowRecord[] = []
      for (const row of legacyList) {
        const window = parseLegacyWindow(legacy, row.sessionId)
        if (window === undefined) continue
        migratedWindows.push({
          key: sessionWindowCacheKey(options.hostId, row.sessionId), kind: 'window', version: RECORD_VERSION,
          hostId: options.hostId, sessionId: row.sessionId, window,
        })
      }
      try {
        await database.writeMigration(listRecord, migratedWindows)
        list = legacyList
        for (const record of migratedWindows) windows.set(record.sessionId, record.window)
        legacy.removeItem(LEGACY_LIST_KEY)
        for (const row of legacyList) legacy.removeItem(LEGACY_HISTORY_PREFIX + row.sessionId)
        migratedLegacy = true
      } catch { /* retain v1 records for a later safe retry */ }
    }
  }

  try { void globalThis.navigator?.storage?.persist?.() } catch { /* best effort */ }
  const adapter = new MobileSessionHydrationAdapter(
    options.hostId, database, list, windows, options.flushDelayMs ?? 50,
  )
  return {
    adapter,
    migratedLegacy,
    flush: () => adapter.flush(),
    dispose: () => adapter.dispose(),
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'))
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
  })
}

export class IndexedDbSessionCacheDatabase implements SessionCacheDatabase {
  private readonly database: IDBDatabase

  private constructor(database: IDBDatabase) { this.database = database }

  static async open(): Promise<IndexedDbSessionCacheDatabase> {
    if (globalThis.indexedDB === undefined) throw new Error('IndexedDB unavailable')
    const request = globalThis.indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains('lists')) database.createObjectStore('lists', { keyPath: 'key' })
      if (!database.objectStoreNames.contains('windows')) {
        const store = database.createObjectStore('windows', { keyPath: 'key' })
        store.createIndex('hostId', 'hostId', { unique: false })
      }
    }
    return new IndexedDbSessionCacheDatabase(await requestResult(request))
  }

  async readList(hostId: string): Promise<unknown> {
    const tx = this.database.transaction('lists', 'readonly')
    return requestResult(tx.objectStore('lists').get(sessionListCacheKey(hostId)))
  }

  async readWindows(hostId: string): Promise<readonly unknown[]> {
    const tx = this.database.transaction('windows', 'readonly')
    return requestResult(tx.objectStore('windows').index('hostId').getAll(hostId))
  }

  async writeList(record: ListRecord): Promise<void> {
    const tx = this.database.transaction('lists', 'readwrite')
    tx.objectStore('lists').put(record)
    await transactionDone(tx)
  }

  async writeWindow(record: WindowRecord): Promise<void> {
    const tx = this.database.transaction('windows', 'readwrite')
    tx.objectStore('windows').put(record)
    await transactionDone(tx)
  }

  async writeMigration(list: ListRecord, windows: readonly WindowRecord[]): Promise<void> {
    const tx = this.database.transaction(['lists', 'windows'], 'readwrite')
    tx.objectStore('lists').put(list)
    const store = tx.objectStore('windows')
    for (const record of windows) store.put(record)
    await transactionDone(tx)
  }

  close(): void { this.database.close() }
}
