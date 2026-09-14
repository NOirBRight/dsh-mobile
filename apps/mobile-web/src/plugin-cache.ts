/** Durable Host plugin + roster cache. IndexedDB holds the full boot graph; localStorage cannot. */
import { gzipDecode, GZIP_PREFIX, validateBootManifest, type BootManifest, type PluginBundleCache } from './manifest.ts'

const DB_NAME = 'dsh-mobile-host-cache'
const DB_VERSION = 1
const BUNDLE_STORE = 'plugin-bundles'
const ROSTER_STORE = 'boot-rosters'

function bundleKey(hostId: string, id: string, rev: string): string {
  return hostId + '\0' + id + '\0' + rev
}

function resolveIndexedDB(indexedDB?: IDBFactory): IDBFactory | undefined {
  return indexedDB ?? globalThis.indexedDB
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

async function openCacheDb(indexedDB: IDBFactory): Promise<IDBDatabase> {
  const request = indexedDB.open(DB_NAME, DB_VERSION)
  request.onupgradeneeded = () => {
    const db = request.result
    if (!db.objectStoreNames.contains(BUNDLE_STORE)) db.createObjectStore(BUNDLE_STORE)
    if (!db.objectStoreNames.contains(ROSTER_STORE)) db.createObjectStore(ROSTER_STORE)
  }
  return requestValue(request)
}

async function decodeBundle(stored: unknown): Promise<string | undefined> {
  if (typeof stored !== 'string' || stored === '') return undefined
  return stored.startsWith(GZIP_PREFIX) ? gzipDecode(stored) : stored
}

/** Content-addressed plugin bundle cache in IndexedDB, keyed by Host Identity + id + rev. */
export function createIndexedDbPluginCache(hostId: string, indexedDB?: IDBFactory): PluginBundleCache | undefined {
  const factory = resolveIndexedDB(indexedDB)
  if (factory === undefined) return undefined
  let opened: Promise<IDBDatabase> | undefined
  const db = (): Promise<IDBDatabase> => {
    opened ??= openCacheDb(factory)
    return opened
  }
  return {
    async read(id, rev) {
      try {
        const database = await db()
        const stored = await requestValue(database.transaction(BUNDLE_STORE, 'readonly').objectStore(BUNDLE_STORE).get(bundleKey(hostId, id, rev)))
        return decodeBundle(stored)
      } catch {
        return undefined
      }
    },
    async write(id, rev, source) {
      try {
        const database = await db()
        await requestValue(database.transaction(BUNDLE_STORE, 'readwrite').objectStore(BUNDLE_STORE).put(source, bundleKey(hostId, id, rev)))
      } catch {
        /* private mode or quota: the caller already has source */
      }
    },
  }
}

/** Persist the unlocalized Host boot roster next to the plugin bundles. */
export async function writeIndexedDbBootManifest(hostId: string, manifest: BootManifest, indexedDB?: IDBFactory): Promise<void> {
  const factory = resolveIndexedDB(indexedDB)
  if (factory === undefined) return
  try {
    const database = await openCacheDb(factory)
    await requestValue(database.transaction(ROSTER_STORE, 'readwrite').objectStore(ROSTER_STORE).put(manifest, hostId))
  } catch {
    /* private mode or quota: localStorage still holds the small roster */
  }
}

/** Read a previously cached Host boot roster from IndexedDB. */
export async function readIndexedDbBootManifest(hostId: string, indexedDB?: IDBFactory): Promise<BootManifest | undefined> {
  const factory = resolveIndexedDB(indexedDB)
  if (factory === undefined) return undefined
  try {
    const database = await openCacheDb(factory)
    const stored = await requestValue(database.transaction(ROSTER_STORE, 'readonly').objectStore(ROSTER_STORE).get(hostId))
    return validateBootManifest(stored)
  } catch {
    return undefined
  }
}

/** Prefer IndexedDB; read through localStorage when IDB is empty or missing. */
export function createDurablePluginCache(
  hostId: string,
  localCache: PluginBundleCache | undefined,
  indexedDB?: IDBFactory,
): PluginBundleCache | undefined {
  const durable = createIndexedDbPluginCache(hostId, indexedDB)
  if (durable === undefined) return localCache
  if (localCache === undefined) return durable
  return {
    async read(id, rev) {
      return await durable.read(id, rev) ?? localCache.read(id, rev)
    },
    async write(id, rev, source) {
      await durable.write(id, rev, source)
    },
  }
}
