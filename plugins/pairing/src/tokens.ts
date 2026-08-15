/**
 * Device token store: the pairing-code → long-lived-token exchange outcome.
 * Tokens are shown once at issue; the file keeps only their SHA-256 hashes,
 * so leaking the store does not leak usable credentials. Revocation is a
 * first-class field from v1 — a leaked token without a revoke path is
 * unrecoverable.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, chmodSync, renameSync } from 'node:fs'
import { dirname } from 'node:path'

/** One paired device as exposed to list/read callers (never carries the hash). */
export interface DeviceRecord {
  id: string
  label?: string
  createdAt: number
  revokedAt: number | null
}

interface StoredDevice extends DeviceRecord {
  tokenHash: string
}

interface StoreFile {
  devices: StoredDevice[]
}

/** JSON-file-backed device token store with atomic writes. */
export class DeviceTokenStore {
  /** The store file path. */
  readonly path: string
  private devices: StoredDevice[]

  /** @param path - store file; a missing file starts empty, a corrupt file throws (fail loud). */
  constructor(path: string) {
    this.path = path
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as StoreFile
      this.devices = Array.isArray(parsed.devices) ? parsed.devices : []
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.devices = []
        return
      }
      throw new Error(`dsh-mobile-pairing: unreadable device store ${path}: ${String(error)}`)
    }
  }

  /**
   * Issue a new device token.
   * @param label - optional human name shown in the device list.
   * @returns the record id and the plaintext token (this is its only showing).
   */
  issue(label?: string): { id: string; token: string } {
    const token = randomBytes(32).toString('base64url')
    const record: StoredDevice = {
      id: randomBytes(8).toString('base64url'),
      label,
      createdAt: Date.now(),
      revokedAt: null,
      tokenHash: hash(token),
    }
    this.devices.push(record)
    this.save()
    return { id: record.id, token }
  }

  /**
   * Authenticate a presented token.
   * @param token - plaintext bearer/subprotocol token.
   * @returns the device record, or null for unknown/revoked tokens.
   */
  authenticate(token: string): DeviceRecord | null {
    const presented = Buffer.from(hash(token))
    for (const device of this.devices) {
      if (device.revokedAt !== null) continue
      const expected = Buffer.from(device.tokenHash)
      if (presented.length === expected.length && timingSafeEqual(presented, expected)) return device
    }
    return null
  }

  /**
   * Revoke a device by id.
   * @param id - record id from {@link list}.
   * @returns whether a live device was found and revoked.
   */
  revoke(id: string): boolean {
    const device = this.devices.find((d) => d.id === id && d.revokedAt === null)
    if (!device) return false
    device.revokedAt = Date.now()
    this.save()
    return true
  }

  /** @returns all devices (including revoked), with token hashes stripped. */
  list(): DeviceRecord[] {
    return this.devices.map(({ id, label, createdAt, revokedAt }) => ({ id, label, createdAt, revokedAt }))
  }

  private save(): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify({ devices: this.devices } satisfies StoreFile, null, 2))
    renameSync(tmp, this.path)
    chmodSync(this.path, 0o600)
  }
}

/** @param token - plaintext token. @returns its SHA-256, base64url. */
function hash(token: string): string {
  return createHash('sha256').update(token).digest('base64url')
}
