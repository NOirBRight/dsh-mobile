/** Host-partitioned session list + current-window cache. Product overlay only. */

export const SESSION_CACHE_DB_NAME = 'dsh-mobile-session-cache-v2'
const RECORD_STORE = 'records'
const RECORD_VERSION = 2 as const

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

export interface SessionCache {
  readList(): Promise<readonly SessionListCacheEntry[] | undefined>
  readWindow(): Promise<{ sessionId: string; window: SessionWindowCacheSeed } | undefined>
  writeList(entries: readonly unknown[]): Promise<void>
  writeWindow(sessionId: string, window: unknown): Promise<void>
}

/** Test-injected Map-like port. Production uses IndexedDB. */
export interface SessionRecordStore {
  get(key: string): Promise<unknown>
  put(key: string, value: unknown): Promise<void>
}

export interface MemorySessionRecordStore extends SessionRecordStore {
  readonly records: Map<string, unknown>
}

const CREDENTIAL_KEY = /deviceToken|clientKeypair|pairingSecret|privateKey|authorization|password|secret|credential/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function listKey(hostId: string): string {
  return hostId + '\0list'
}

function windowKey(hostId: string): string {
  return hostId + '\0window'
}

function projectionAgentPreset(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined
  return optionalString(value.agentPreset)
}

/** Persist only durable display facts; live-only bits stay off the record. */
export function normalizeListEntry(value: unknown): SessionListCacheEntry | undefined {
  if (!isRecord(value)) return undefined
  const sessionId = optionalString(value.sessionId) ?? optionalString(value.id)
  if (sessionId === undefined) return undefined
  if (typeof value.updatedAt !== 'number' || !Number.isFinite(value.updatedAt)) return undefined
  if (typeof value.blank !== 'boolean') return undefined
  const origin = value.origin === 'subagent' ? 'subagent' as const : undefined
  const parentSessionId = optionalString(value.parentSessionId) ?? optionalString(value.parentId)
  const agentPreset = optionalString(value.agentPreset) ?? projectionAgentPreset(value.projectionValues)
  return {
    sessionId,
    ...(optionalString(value.title) === undefined ? {} : { title: optionalString(value.title) }),
    updatedAt: value.updatedAt,
    blank: value.blank,
    ...(parentSessionId === undefined ? {} : { parentSessionId }),
    ...(origin === undefined ? {} : { origin }),
    ...(optionalString(value.cwd) === undefined ? {} : { cwd: optionalString(value.cwd) }),
    ...(agentPreset === undefined ? {} : { agentPreset }),
  }
}

export function normalizeList(entries: unknown): SessionListCacheEntry[] | undefined {
  if (!Array.isArray(entries) || entries.length > 10_000) return undefined
  const normalized: SessionListCacheEntry[] = []
  for (const entry of entries) {
    const row = normalizeListEntry(entry)
    if (row === undefined) return undefined
    normalized.push(row)
  }
  return normalized
}

function durableEvent(event: Record<string, unknown>): Record<string, unknown> | undefined {
  if (typeof event.type !== 'string' || !Number.isSafeInteger(event.seq) || (event.seq as number) < 0) return undefined
  if (typeof event.time !== 'number' || !Number.isFinite(event.time)) return undefined
  const data = isRecord(event.data) ? Object.fromEntries(
    Object.entries(event.data).filter(([key]) => !CREDENTIAL_KEY.test(key)),
  ) : undefined
  return {
    type: event.type,
    seq: event.seq,
    time: event.time,
    ...(data === undefined ? {} : { data }),
  }
}

function normalizeHistoryEntry(value: unknown): { event: Record<string, unknown> } | undefined {
  if (!isRecord(value)) return undefined
  const rawEvent = isRecord(value.event) ? value.event : undefined
  if (rawEvent === undefined) return undefined
  if (value.type !== undefined && value.type !== 'event' && value.type !== 'chunks') return undefined
  const event = durableEvent(rawEvent)
  return event === undefined ? undefined : { event }
}

export function normalizeWindow(value: unknown): SessionWindowCacheSeed | undefined {
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
  return normalizeList(raw.entries)
}

function readWindowRecord(raw: unknown, hostId: string): { sessionId: string; window: SessionWindowCacheSeed } | undefined {
  if (!isRecord(raw) || raw.version !== RECORD_VERSION || raw.kind !== 'window' || raw.hostId !== hostId) return undefined
  if (typeof raw.sessionId !== 'string' || raw.sessionId.length === 0) return undefined
  const window = normalizeWindow(raw.window)
  return window === undefined ? undefined : { sessionId: raw.sessionId, window }
}

export function createMemorySessionRecordStore(): MemorySessionRecordStore {
  const records = new Map<string, unknown>()
  return {
    records,
    async get(key) { return records.get(key) },
    async put(key, value) { records.set(key, structuredClone(value) as unknown) },
  }
}

function createCache(hostId: string, store: SessionRecordStore): SessionCache {
  return {
    async readList() {
      try {
        return readListRecord(await store.get(listKey(hostId)), hostId)
      } catch {
        return undefined
      }
    },
    async readWindow() {
      try {
        return readWindowRecord(await store.get(windowKey(hostId)), hostId)
      } catch {
        return undefined
      }
    },
    async writeList(entries) {
      const normalized = normalizeList(entries)
      if (normalized === undefined) return
      try {
        await store.put(listKey(hostId), {
          kind: 'list',
          version: RECORD_VERSION,
          hostId,
          entries: normalized,
        })
      } catch { /* private mode: overlay still paints from memory this session */ }
    },
    async writeWindow(sessionId, window) {
      if (typeof sessionId !== 'string' || sessionId.length === 0) return
      const normalized = normalizeWindow(window)
      if (normalized === undefined) return
      try {
        await store.put(windowKey(hostId), {
          kind: 'window',
          version: RECORD_VERSION,
          hostId,
          sessionId,
          window: normalized,
        })
      } catch { /* same degrade as list writes */ }
    },
  }
}

function isRecordStore(value: object): value is SessionRecordStore {
  return typeof (value as SessionRecordStore).get === 'function'
    && typeof (value as SessionRecordStore).put === 'function'
    && typeof (value as IDBFactory).open !== 'function'
}

function resolveIndexedDb(indexedDB?: IDBFactory | null): IDBFactory | undefined {
  if (indexedDB === null) return undefined
  if (indexedDB !== undefined) return indexedDB
  try {
    const globalDb = globalThis.indexedDB
    return globalDb === undefined || globalDb === null ? undefined : globalDb
  } catch {
    return undefined
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

function createIndexedDbRecordStore(factory: IDBFactory): SessionRecordStore {
  let opened: Promise<IDBDatabase> | undefined
  const open = (): Promise<IDBDatabase> => {
    opened ??= new Promise((resolve, reject) => {
      const request = factory.open(SESSION_CACHE_DB_NAME, 1)
      request.onupgradeneeded = () => {
        const database = request.result
        if (!database.objectStoreNames.contains(RECORD_STORE)) database.createObjectStore(RECORD_STORE)
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
    })
    return opened
  }
  return {
    async get(key) {
      const database = await open()
      const tx = database.transaction(RECORD_STORE, 'readonly')
      return requestResult(tx.objectStore(RECORD_STORE).get(key))
    },
    async put(key, value) {
      const database = await open()
      const tx = database.transaction(RECORD_STORE, 'readwrite')
      tx.objectStore(RECORD_STORE).put(value, key)
      await transactionDone(tx)
    },
  }
}

/** Partitioned session cache. Tests inject a Map store; omit the factory to use IndexedDB. */
export function createSessionCache(hostId: string, store: SessionRecordStore): SessionCache {
  return createCache(hostId, store)
}

/**
 * Durable session cache partitioned by Host Identity.
 * Pass a Map-like record store in tests; omit the second argument to use
 * `globalThis.indexedDB`. Missing IndexedDB returns undefined.
 */
export function createIndexedDbSessionCache(
  hostId: string,
  indexedDB?: IDBFactory | SessionRecordStore | null,
): SessionCache | undefined {
  if (indexedDB !== undefined && indexedDB !== null && isRecordStore(indexedDB)) {
    return createCache(hostId, indexedDB)
  }
  const factory = resolveIndexedDb(indexedDB as IDBFactory | null | undefined)
  if (factory === undefined) return undefined
  return createCache(hostId, createIndexedDbRecordStore(factory))
}
