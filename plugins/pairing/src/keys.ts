/**
 * Persistent Curve25519 (X25519) daemon keypair — the pairing trust anchor
 * whose public key rides inside the QR (Paseo's daemon-keypair.json pattern).
 * The JWK `x` of an X25519 key is the base64url of the raw 32-byte public
 * key, exactly what the offer payload carries.
 */
import { generateKeyPairSync, createPrivateKey, createPublicKey } from 'node:crypto'
import type { JsonWebKey, KeyObject } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs'
import { dirname } from 'node:path'

/** A loaded (or freshly minted) daemon keypair. */
export interface DaemonKeypair {
  publicKey: KeyObject
  privateKey: KeyObject
  /** Raw 32-byte public key, base64url — the value placed into pairing offers. */
  publicKeyBase64Url: string
}

/**
 * Load the keypair from `path`, or mint and persist one on first run.
 * A missing file creates; a CORRUPT file throws — silently rotating the daemon
 * identity would break every paired device without a trace.
 * @param path - keypair JWK file (written mode 0600).
 * @returns the resident keypair.
 */
export function loadOrCreateKeypair(path: string): DaemonKeypair {
  let jwk: unknown
  try {
    jwk = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return mint(path)
    throw new Error(`dsh-mobile-pairing: unreadable keypair file ${path}: ${String(error)}`)
  }
  const j = jwk as { kty?: string; crv?: string; x?: string; d?: string }
  if (j.kty !== 'OKP' || j.crv !== 'X25519' || typeof j.x !== 'string' || typeof j.d !== 'string') {
    throw new Error(`dsh-mobile-pairing: ${path} is not an X25519 JWK — remove it to re-mint (breaks paired devices)`)
  }
  const privateKey = createPrivateKey({ key: jwk as JsonWebKey, format: 'jwk' })
  return { publicKey: createPublicKey(privateKey), privateKey, publicKeyBase64Url: j.x }
}

/** @param path - destination file. @returns a fresh keypair persisted at `path`. */
function mint(path: string): DaemonKeypair {
  const { publicKey, privateKey } = generateKeyPairSync('x25519')
  const jwk = privateKey.export({ format: 'jwk' }) as { x: string }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(jwk, null, 2))
  chmodSync(path, 0o600)
  return { publicKey, privateKey, publicKeyBase64Url: jwk.x }
}
