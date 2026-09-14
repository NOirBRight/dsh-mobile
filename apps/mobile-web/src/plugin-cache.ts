/** IndexedDB adapter for host plugin bundles. Boot roster stays on localStorage. */

import type { PluginBundleCache } from './manifest.ts'

export const PLUGIN_BUNDLE_DB_NAME = 'dsh-mobile-plugin-bundles-v1'
const BUNDLE_STORE = 'bundles'
const GZIP_PREFIX = 'gz1:'

/** Test-injected Map-like port. Production uses IndexedDB. */
export interface PluginBundleRecordStore {
  get(key: string): Promise<string | undefined>
  put(key: string, value: string): Promise<void>
}

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

async function decodeStored(stored: string | undefined): Promise<string | undefined> {
  if (stored === undefined) return undefined
  if (stored.startsWith(GZIP_PREFIX)) return gzipDecode(stored)
  return stored
}

function recordKey(hostId: string, id: string, rev: string): string {
  return hostId + '\0' + id + '\0' + rev
}

function isRecordStore(value: object): value is PluginBundleRecordStore {
  return typeof (value as PluginBundleRecordStore).get === 'function'
    && typeof (value as PluginBundleRecordStore).put === 'function'
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

function createIndexedDbRecordStore(factory: IDBFactory): PluginBundleRecordStore {
  let opened: Promise<IDBDatabase> | undefined
  const open = (): Promise<IDBDatabase> => {
    opened ??= new Promise((resolve, reject) => {
      const request = factory.open(PLUGIN_BUNDLE_DB_NAME, 1)
      request.onupgradeneeded = () => {
        const database = request.result
        if (!database.objectStoreNames.contains(BUNDLE_STORE)) database.createObjectStore(BUNDLE_STORE)
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
    })
    return opened
  }
  return {
    async get(key) {
      const database = await open()
      const tx = database.transaction(BUNDLE_STORE, 'readonly')
      const stored = await requestResult(tx.objectStore(BUNDLE_STORE).get(key))
      return typeof stored === 'string' ? stored : undefined
    },
    async put(key, value) {
      const database = await open()
      const tx = database.transaction(BUNDLE_STORE, 'readwrite')
      tx.objectStore(BUNDLE_STORE).put(value, key)
      await transactionDone(tx)
    },
  }
}

function createCache(hostId: string, store: PluginBundleRecordStore): PluginBundleCache {
  return {
    async read(id, rev) {
      try {
        return await decodeStored(await store.get(recordKey(hostId, id, rev)))
      } catch {
        return undefined
      }
    },
    async write(id, rev, source) {
      const value = gzipCapable() ? await gzipEncode(source) : source
      try {
        await store.put(recordKey(hostId, id, rev), value)
      } catch {
        /* private mode / unavailable origin: next hydrate misses and re-downloads */
      }
    },
  }
}

/**
 * Content-addressed plugin bundle cache partitioned by Host Identity.
 * Pass a Map-like record store in tests; omit the second argument to use
 * `globalThis.indexedDB`. Missing IndexedDB returns undefined so cache-only
 * hydrate fails closed and the live tunnel download path runs.
 */
export function createIndexedDbPluginCache(
  hostId: string,
  indexedDB?: IDBFactory | PluginBundleRecordStore | null,
): PluginBundleCache | undefined {
  if (indexedDB !== undefined && indexedDB !== null && isRecordStore(indexedDB)) {
    return createCache(hostId, indexedDB)
  }
  const factory = resolveIndexedDb(indexedDB as IDBFactory | null | undefined)
  if (factory === undefined) return undefined
  return createCache(hostId, createIndexedDbRecordStore(factory))
}
