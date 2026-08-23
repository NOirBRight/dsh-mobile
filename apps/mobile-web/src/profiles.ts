export const HOST_PROFILE_SCHEMA_VERSION = 1 as const
export const PROFILE_STORE_SCHEMA_VERSION = 1 as const

export type HostId = string
export type EndpointKind = 'temporary' | 'custom' | 'relay'
export type ConnectionPolicy = 'automatic' | 'direct-only' | 'tunnel-only'

/** Lets pairing UI require explicit acknowledgement instead of silently replacing a Host. */
export class HostIdentityMismatchError extends Error {
  readonly savedHostId: HostId
  readonly presentedHostId: HostId
  readonly endpoint: string

  constructor(savedHostId: HostId, presentedHostId: HostId, endpoint: string) {
    super('endpoint belongs to a different Host Identity')
    this.name = 'HostIdentityMismatchError'
    this.savedHostId = savedHostId
    this.presentedHostId = presentedHostId
    this.endpoint = endpoint
  }
}

export interface HostEndpoint {
  url: string
  kind: EndpointKind
}

export type HostPresentationState = Record<string, string | number | boolean | null>

export interface HostProfile {
  schemaVersion: typeof HOST_PROFILE_SCHEMA_VERSION
  /** Stable Host public-key identity; endpoint and display name are mutable metadata. */
  hostId: HostId
  displayName: string
  endpoint: HostEndpoint
  capabilities: string[]
  /** Opaque reference into a credential vault, never credential material. */
  credentialRef: string
  /** Authorized Room bound to this Host device record (128-bit lowercase hex). */
  room: string
  /** STUN discovery only; official Relay offers leave this empty. */
  ice: string[]
  connectionPolicy: ConnectionPolicy
  /** Host-local shell presentation state, restored independently per Profile. */
  presentation: HostPresentationState
  createdAt: string
  updatedAt: string
}

export interface ProfileStoreDocument {
  schemaVersion: typeof PROFILE_STORE_SCHEMA_VERSION
  profiles: Record<HostId, HostProfile>
  activeHostId: HostId | null
}

export interface ProfileStorage {
  load(): Promise<ProfileStoreDocument | null>
  save(document: ProfileStoreDocument): Promise<void>
}

function emptyDocument(): ProfileStoreDocument {
  return {
    schemaVersion: PROFILE_STORE_SCHEMA_VERSION,
    profiles: Object.create(null) as Record<HostId, HostProfile>,
    activeHostId: null,
  }
}

function copy<T>(value: T): T {
  return structuredClone(value)
}

export interface ProfileBrowserStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const BROWSER_PROFILE_KEY = 'dsh-mobile:host-profiles'

/** Persists non-secret Profile metadata in browser origin-scoped storage. */
export class BrowserProfileStorage implements ProfileStorage {
  readonly #storage: ProfileBrowserStorage

  constructor(storage: ProfileBrowserStorage = localStorage) {
    this.#storage = storage
  }

  async load(): Promise<ProfileStoreDocument | null> {
    const stored = this.#storage.getItem(BROWSER_PROFILE_KEY)
    if (stored === null) return null
    const parsed: unknown = JSON.parse(stored)
    if (!isProfileStoreDocument(parsed)) throw new Error('unsupported or corrupt Host Profile store')
    return copy(parsed)
  }

  async save(document: ProfileStoreDocument): Promise<void> {
    this.#storage.setItem(BROWSER_PROFILE_KEY, JSON.stringify(document))
  }
}

function isProfileStoreDocument(value: unknown): value is ProfileStoreDocument {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== PROFILE_STORE_SCHEMA_VERSION) return false
  if (record.activeHostId !== null && typeof record.activeHostId !== 'string') return false
  if (typeof record.profiles !== 'object' || record.profiles === null) return false
  const credentialRefs = new Set<string>()
  for (const [hostId, candidate] of Object.entries(record.profiles)) {
    if (!isHostProfile(candidate) || candidate.hostId !== hostId) return false
    if (credentialRefs.has(candidate.credentialRef)) return false
    credentialRefs.add(candidate.credentialRef)
  }
  return record.activeHostId === null || Object.hasOwn(record.profiles, record.activeHostId)
}

const HOST_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/
const V4_ROOM_PATTERN = /^[0-9a-f]{32}$/

function assertHostId(hostId: HostId): void {
  if (!HOST_ID_PATTERN.test(hostId)) throw new Error('invalid Host Identity')
}

function isHostProfile(value: unknown): value is HostProfile {
  if (typeof value !== 'object' || value === null) return false
  const profile = value as Record<string, unknown>
  const endpoint = profile.endpoint as Record<string, unknown> | undefined
  return profile.schemaVersion === HOST_PROFILE_SCHEMA_VERSION
    && typeof profile.hostId === 'string' && HOST_ID_PATTERN.test(profile.hostId)
    && typeof profile.displayName === 'string'
    && typeof endpoint === 'object' && endpoint !== null
    && typeof endpoint.url === 'string'
    && (endpoint.kind === 'temporary' || endpoint.kind === 'custom' || (endpoint.kind === 'relay' && isRelayUrl(endpoint.url)))
    && Array.isArray(profile.capabilities) && profile.capabilities.every(value => typeof value === 'string')
    && typeof profile.credentialRef === 'string'
    && typeof profile.room === 'string' && V4_ROOM_PATTERN.test(profile.room)
    && Array.isArray(profile.ice) && profile.ice.every(isStunUrl)
    && (profile.connectionPolicy === 'automatic' || profile.connectionPolicy === 'direct-only' || profile.connectionPolicy === 'tunnel-only')
    && isPresentationState(profile.presentation)
    && typeof profile.createdAt === 'string'
    && typeof profile.updatedAt === 'string'
}

function isRelayUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'wss:' && url.username === '' && url.password === '' && url.search === '' && url.hash === ''
  } catch {
    return false
  }
}

function isStunUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = /^stun:(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)(?::([0-9]{1,5}))?$/.exec(value)
  if (match === null) return false
  if (match[2] === undefined) return true
  const port = Number(match[2])
  return port > 0 && port <= 65_535
}

function isPresentationState(value: unknown): value is HostPresentationState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Object.values(value).every(item => item === null
    || typeof item === 'string'
    || typeof item === 'number'
    || typeof item === 'boolean')
}

export class MemoryProfileStorage implements ProfileStorage {
  #document: ProfileStoreDocument | null = null

  async load(): Promise<ProfileStoreDocument | null> {
    return this.#document === null ? null : copy(this.#document)
  }

  async save(document: ProfileStoreDocument): Promise<void> {
    this.#document = copy(document)
  }
}

export interface CredentialRefRemover {
  delete(ref: string): Promise<void>
  exists?(ref: string): Promise<boolean>
}

export class ProfileRepository {
  readonly #storage: ProfileStorage
  readonly #vault: CredentialRefRemover
  #pendingWrite: Promise<void> = Promise.resolve()

  constructor(storage: ProfileStorage, vault: CredentialRefRemover) {
    this.#storage = storage
    this.#vault = vault
  }

  async list(): Promise<HostProfile[]> {
    await this.#pendingWrite
    const document = await this.#load()
    return Object.values(document.profiles).map(copy)
  }

  async getActive(): Promise<HostProfile | undefined> {
    await this.#pendingWrite
    const document = await this.#load()
    const profile = document.activeHostId === null || !Object.hasOwn(document.profiles, document.activeHostId)
      ? undefined
      : document.profiles[document.activeHostId]
    return profile === undefined ? undefined : copy(profile)
  }

  async upsert(profile: HostProfile): Promise<HostProfile> {
    return this.#serialize(() => this.#upsert(profile))
  }

  async #upsert(profile: HostProfile): Promise<HostProfile> {
    assertHostId(profile.hostId)
    if (profile.schemaVersion !== HOST_PROFILE_SCHEMA_VERSION) {
      throw new Error(`unsupported HostProfile schema version: ${profile.schemaVersion}`)
    }
    if (!isHostProfile(profile)) throw new Error('invalid HostProfile')
    const document = await this.#load()
    const credentialOwner = Object.values(document.profiles).find(
      saved => saved.credentialRef === profile.credentialRef && saved.hostId !== profile.hostId,
    )
    if (credentialOwner !== undefined) {
      throw new Error(`credential ref already belongs to another Host: ${credentialOwner.hostId}`)
    }
    const previous = document.profiles[profile.hostId]
    let next = copy(profile)
    if (previous !== undefined && previous.credentialRef !== next.credentialRef && this.#vault.exists) {
      const incomingExists = await this.#vault.exists(next.credentialRef)
      if (!incomingExists) next = { ...next, credentialRef: previous.credentialRef }
    }
    document.profiles[next.hostId] = copy(next)
    document.activeHostId ??= next.hostId
    await this.#storage.save(document)
    if (previous !== undefined && previous.credentialRef !== next.credentialRef) {
      await this.#vault.delete(previous.credentialRef)
    }
    return copy(next)
  }

  async acknowledgeIdentityChange(
    conflict: HostIdentityMismatchError,
    replacement: HostProfile,
  ): Promise<HostProfile> {
    return this.#serialize(() => this.#acknowledgeIdentityChange(conflict, replacement))
  }

  async #acknowledgeIdentityChange(
    conflict: HostIdentityMismatchError,
    replacement: HostProfile,
  ): Promise<HostProfile> {
    assertHostId(replacement.hostId)
    if (!isHostProfile(replacement)) throw new Error('invalid HostProfile')
    if (replacement.hostId !== conflict.presentedHostId || replacement.endpoint.url !== conflict.endpoint) {
      throw new Error('identity acknowledgement does not match the presented Host')
    }

    const document = await this.#load()
    const saved = Object.hasOwn(document.profiles, conflict.savedHostId)
      ? document.profiles[conflict.savedHostId]
      : undefined
    if (saved === undefined || saved.endpoint.url !== conflict.endpoint) {
      throw new Error('Host Identity conflict is stale')
    }
    const credentialOwner = Object.values(document.profiles).find(
      profile => profile.credentialRef === replacement.credentialRef
        && profile.hostId !== conflict.savedHostId,
    )
    if (credentialOwner !== undefined) {
      throw new Error(`credential ref already belongs to another Host: ${credentialOwner.hostId}`)
    }

    delete document.profiles[conflict.savedHostId]
    document.profiles[replacement.hostId] = copy(replacement)
    if (document.activeHostId === conflict.savedHostId) document.activeHostId = replacement.hostId
    await this.#storage.save(document)
    if (saved.credentialRef !== replacement.credentialRef) await this.#vault.delete(saved.credentialRef)
    return copy(replacement)
  }

  async updateDisplayName(hostId: HostId, displayName: string): Promise<HostProfile> {
    return this.#serialize(async () => {
      assertHostId(hostId)
      const normalized = displayName.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 64)
      if (normalized === '') throw new Error('Host Display Name must not be empty')
      const document = await this.#load()
      const current = document.profiles[hostId]
      if (current === undefined) throw new Error(`unknown Host Identity: ${hostId}`)
      const renamed = { ...current, displayName: normalized, updatedAt: new Date().toISOString() }
      document.profiles[hostId] = renamed
      await this.#storage.save(document)
      return copy(renamed)
    })
  }

  async refreshEndpoint(
    hostId: HostId,
    refresh: Pick<HostProfile, 'endpoint' | 'capabilities' | 'updatedAt'>,
  ): Promise<HostProfile> {
    return this.#serialize(() => this.#refreshEndpoint(hostId, refresh))
  }

  async #refreshEndpoint(
    hostId: HostId,
    refresh: Pick<HostProfile, 'endpoint' | 'capabilities' | 'updatedAt'>,
  ): Promise<HostProfile> {
    assertHostId(hostId)
    const document = await this.#load()
    const current = document.profiles[hostId]
    if (current === undefined) throw new Error(`unknown Host Identity: ${hostId}`)
    const refreshed: HostProfile = {
      ...current,
      endpoint: copy(refresh.endpoint),
      capabilities: copy(refresh.capabilities),
      updatedAt: refresh.updatedAt,
    }
    if (!isHostProfile(refreshed)) throw new Error('invalid Endpoint Refresh')
    document.profiles[hostId] = refreshed
    await this.#storage.save(document)
    return copy(refreshed)
  }

  async setActiveHost(hostId: HostId): Promise<void> {
    return this.#serialize(() => this.#setActiveHost(hostId))
  }

  async #setActiveHost(hostId: HostId): Promise<void> {
    assertHostId(hostId)
    const document = await this.#load()
    if (!Object.hasOwn(document.profiles, hostId)) throw new Error(`unknown Host Identity: ${hostId}`)
    document.activeHostId = hostId
    await this.#storage.save(document)
  }

  async remove(hostId: HostId): Promise<boolean> {
    return this.#serialize(() => this.#remove(hostId))
  }

  async #remove(hostId: HostId): Promise<boolean> {
    assertHostId(hostId)
    const document = await this.#load()
    const profile = Object.hasOwn(document.profiles, hostId) ? document.profiles[hostId] : undefined
    if (profile === undefined) return false

    delete document.profiles[hostId]
    if (document.activeHostId === hostId) {
      document.activeHostId = Object.keys(document.profiles)[0] ?? null
    }
    await this.#storage.save(document)
    await this.#vault.delete(profile.credentialRef)
    return true
  }

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#pendingWrite.then(operation)
    this.#pendingWrite = result.then(() => undefined, () => undefined)
    return result
  }

  async #load(): Promise<ProfileStoreDocument> {
    return (await this.#storage.load()) ?? emptyDocument()
  }
}
