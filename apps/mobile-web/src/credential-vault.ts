export type SecretRef = string
export type VaultSecret = Uint8Array

export class CredentialRePairRequiredError extends Error {
  constructor() {
    super('stored browser credential is incompatible; explicit re-pairing is required')
    this.name = 'CredentialRePairRequiredError'
  }
}

export interface CredentialVault {
  store(secret: VaultSecret): Promise<SecretRef>
  replace(ref: SecretRef, secret: VaultSecret): Promise<void>
  delete(ref: SecretRef): Promise<void>
}

/** Browser and test adapters may read credentials inside their origin/runtime. */
export interface ReadableCredentialVault extends CredentialVault {
  read(ref: SecretRef): Promise<VaultSecret | undefined>
}

export interface BrowserStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const BROWSER_VAULT_PREFIX = 'dsh-mobile:credential:'
const LEGACY_ANDROID_CREDENTIAL_KEYS = ['dsh-mobile.offer', 'dsh-mobile.deviceToken'] as const

/** v1-v3 WebView credentials cannot become v4 Host authorization; purge them before native bootstrap. */
export function purgeLegacyAndroidWebCredentials(storage: Pick<Storage, 'removeItem'>): void {
  for (const key of LEGACY_ANDROID_CREDENTIAL_KEYS) storage.removeItem(key)
}

function encodeBase64(secret: VaultSecret): string {
  let binary = ''
  for (const octet of secret) binary += String.fromCharCode(octet)
  return btoa(binary)
}

function decodeBase64(encoded: string): VaultSecret {
  const binary = atob(encoded)
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

/** Origin-scoped vault for tests and non-native shells. Not a Product Client. */
export class BrowserCredentialVault implements ReadableCredentialVault {
  readonly #storage: BrowserStorage

  constructor(storage: BrowserStorage = localStorage) {
    this.#storage = storage
  }

  async store(secret: VaultSecret): Promise<SecretRef> {
    const ref = `browser-vault:${crypto.randomUUID()}`
    this.#storage.setItem(BROWSER_VAULT_PREFIX + ref, JSON.stringify({ schemaVersion: 1, secret: encodeBase64(secret) }))
    return ref
  }

  async replace(ref: SecretRef, secret: VaultSecret): Promise<void> {
    this.#storage.setItem(BROWSER_VAULT_PREFIX + ref, JSON.stringify({ schemaVersion: 1, secret: encodeBase64(secret) }))
  }

  async read(ref: SecretRef): Promise<VaultSecret | undefined> {
    const stored = this.#storage.getItem(BROWSER_VAULT_PREFIX + ref)
    if (stored === null) return undefined
    let parsed: unknown
    try {
      parsed = JSON.parse(stored)
    } catch {
      throw new CredentialRePairRequiredError()
    }
    if (!isBrowserSecret(parsed)) throw new CredentialRePairRequiredError()
    return decodeBase64(parsed.secret)
  }

  async delete(ref: SecretRef): Promise<void> {
    this.#storage.removeItem(BROWSER_VAULT_PREFIX + ref)
  }

  async exists(ref: SecretRef): Promise<boolean> {
    return this.#storage.getItem(BROWSER_VAULT_PREFIX + ref) !== null
  }
}

function isBrowserSecret(value: unknown): value is { schemaVersion: 1; secret: string } {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return record.schemaVersion === 1 && typeof record.secret === 'string'
}

/** Private App Shell bridge. Do not add this object to Host UI runtime interfaces. */
export interface NativeCredentialVaultBridge {
  storeSecret(options: { secretBase64: string }): Promise<{ ref: string }>
  replaceSecret(options: { ref: string; secretBase64: string }): Promise<void>
  readSecret(options: { ref: string }): Promise<{ secretBase64?: string }>
  deleteSecret(options: { ref: string }): Promise<void>
}

const MAX_NATIVE_SECRET_BYTES = 65_536
const NATIVE_SECRET_REF_PATTERN = /^vault:[A-Za-z0-9_-]{43}$/

export class NativeCredentialVault implements ReadableCredentialVault {
  readonly #bridge: NativeCredentialVaultBridge

  constructor(bridge: NativeCredentialVaultBridge) {
    this.#bridge = bridge
  }

  async store(secret: VaultSecret): Promise<SecretRef> {
    if (secret.byteLength === 0) throw new Error('native credential must not be empty')
    if (secret.byteLength > MAX_NATIVE_SECRET_BYTES) throw new Error('native credential is too large')
    const result = await this.#bridge.storeSecret({ secretBase64: encodeBase64(secret) })
    if (!NATIVE_SECRET_REF_PATTERN.test(result.ref)) {
      throw new Error('native credential vault returned an invalid secret ref')
    }
    return result.ref
  }

  async replace(ref: SecretRef, secret: VaultSecret): Promise<void> {
    if (!NATIVE_SECRET_REF_PATTERN.test(ref)) throw new Error('invalid native secret ref')
    if (secret.byteLength === 0) throw new Error('native credential must not be empty')
    if (secret.byteLength > MAX_NATIVE_SECRET_BYTES) throw new Error('native credential is too large')
    await this.#bridge.replaceSecret({ ref, secretBase64: encodeBase64(secret) })
  }

  async read(ref: SecretRef): Promise<VaultSecret | undefined> {
    if (!NATIVE_SECRET_REF_PATTERN.test(ref)) throw new Error('invalid native secret ref')
    const result = await this.#bridge.readSecret({ ref })
    if (result.secretBase64 === undefined) return undefined
    let secret: VaultSecret
    try {
      secret = decodeBase64(result.secretBase64)
    } catch {
      throw new Error('native credential vault returned an invalid secret')
    }
    if (secret.byteLength === 0 || secret.byteLength > MAX_NATIVE_SECRET_BYTES) {
      secret.fill(0)
      throw new Error('native credential vault returned an invalid secret')
    }
    return secret
  }

  async delete(ref: SecretRef): Promise<void> {
    await this.#bridge.deleteSecret({ ref })
  }

  async exists(ref: SecretRef): Promise<boolean> {
    if (!NATIVE_SECRET_REF_PATTERN.test(ref)) return false
    const result = await this.#bridge.readSecret({ ref })
    return result.secretBase64 !== undefined
  }
}

export class MemoryCredentialVault implements ReadableCredentialVault {
  readonly #secrets = new Map<SecretRef, VaultSecret>()

  async store(secret: VaultSecret): Promise<SecretRef> {
    const ref = `vault:${crypto.randomUUID()}`
    this.#secrets.set(ref, secret.slice())
    return ref
  }

  async replace(ref: SecretRef, secret: VaultSecret): Promise<void> {
    this.#secrets.set(ref, secret.slice())
  }

  async read(ref: SecretRef): Promise<VaultSecret | undefined> {
    return this.#secrets.get(ref)?.slice()
  }

  async delete(ref: SecretRef): Promise<void> {
    this.#secrets.delete(ref)
  }

  async exists(ref: SecretRef): Promise<boolean> {
    return this.#secrets.has(ref)
  }
}
