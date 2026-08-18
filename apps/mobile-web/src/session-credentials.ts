import { b64urlDecode, b64urlEncode, type ClientKeypair } from '@dsh-mobile/e2e-tunnel'

export interface SessionCredential {
  clientKeypair: ClientKeypair
  deviceToken?: string
  pairingCode?: string
}

interface StoredSessionCredential {
  v: 1
  publicKey: string
  secretKey: string
  deviceToken?: string
  pairingCode?: string
}

/** Encode only vault material; Profile metadata is deliberately excluded. */
export function encodeSessionCredential(value: SessionCredential): Uint8Array {
  assertKeypair(value.clientKeypair)
  if (value.deviceToken !== undefined && !validToken(value.deviceToken)) throw new Error('invalid session credential')
  if (value.pairingCode !== undefined && !validPairingCode(value.pairingCode)) throw new Error('invalid session credential')
  if (value.deviceToken !== undefined && value.pairingCode !== undefined) throw new Error('invalid session credential')
  const stored: StoredSessionCredential = {
    v: 1,
    publicKey: b64urlEncode(value.clientKeypair.publicKey),
    secretKey: b64urlEncode(value.clientKeypair.secretKey),
    ...(value.deviceToken === undefined ? {} : { deviceToken: value.deviceToken }),
    ...(value.pairingCode === undefined ? {} : { pairingCode: value.pairingCode }),
  }
  return new TextEncoder().encode(JSON.stringify(stored))
}

/** Decode vault material into short-lived connection inputs. */
export function decodeSessionCredential(bytes: Uint8Array): SessionCredential {
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as Partial<StoredSessionCredential>
    if (value.v !== 1 || typeof value.publicKey !== 'string' || typeof value.secretKey !== 'string') throw new Error()
    if (value.deviceToken !== undefined && !validToken(value.deviceToken)) throw new Error()
    if (value.pairingCode !== undefined && !validPairingCode(value.pairingCode)) throw new Error()
    if (value.deviceToken !== undefined && value.pairingCode !== undefined) throw new Error()
    const clientKeypair = { publicKey: b64urlDecode(value.publicKey), secretKey: b64urlDecode(value.secretKey) }
    assertKeypair(clientKeypair)
    return {
      clientKeypair,
      ...(value.deviceToken === undefined ? {} : { deviceToken: value.deviceToken }),
      ...(value.pairingCode === undefined ? {} : { pairingCode: value.pairingCode }),
    }
  } catch {
    throw new Error('invalid session credential')
  }
}

function assertKeypair(value: ClientKeypair): void {
  if (value.publicKey.length !== 32 || value.secretKey.length !== 32) throw new Error('invalid session credential')
}

function validPairingCode(value: unknown): value is string {
  return typeof value === 'string' && (/^\d{6}$/.test(value) || /^[A-Za-z0-9_-]{32}$/.test(value))
}

function validToken(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512
}
