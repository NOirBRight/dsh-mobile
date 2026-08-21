/**
 * Host side of the M3 tunnel handshake (docs/tunnel-protocol.md §2).
 *
 * Frame layouts (binary WS frames):
 *   client → host: clientPub(32B) || nonce(24B) || box(helloJson, hostPub, clientSec)
 *   host → client: nonce(24B) || box(ackJson, clientPub, hostSec)
 *   host → client on failure: PLAINTEXT error frame — a binary frame carrying
 *   raw JSON bytes {"error": ...}. Vocabulary: bad-hello (unsealable /
 *   unparseable), bad-code (unknown or burned pairing code), expired
 *   (out-of-window code), bad-token (unknown or revoked device token).
 *
 * helloJson is { code, label?, clientType? } | { deviceToken }. A valid code pairs a NEW device:
 * the ack carries { ok, deviceToken } — the token's only showing; the store
 * keeps its hash (protocol §5: permanent until revoked). A code is claimed by
 * one Client Instance key; retries from that key receive the same token while
 * every other key is rejected. A valid deviceToken reconnects only that same
 * Client Instance key: ack is { ok }. A stolen token presented by another key
 * is bad-token. Token reconnect does not move the device's room.
 */
import nacl from 'tweetnacl'
import type { DaemonKeypair } from './keys.ts'
import type { PairingOfferManager } from './pairing.ts'
import { DeviceLimitError, type DeviceClientType, type DeviceTokenStore } from './tokens.ts'

/** clientPub(32) || nonce(24) prefix length of a client handshake frame. */
export const HANDSHAKE_PREFIX_BYTES = 56

/** What the handshake needs: identity, one-time codes, and the device store. */
export interface HandshakeDeps {
  keypair: DaemonKeypair
  offers: PairingOfferManager
  devices: DeviceTokenStore
  /** Room of the relay campaign this handshake arrived on; bound to newly issued device records. */
  room?: string
}

/** Handshake result: on success the sealed ack frame to send; on failure the plaintext error frame. */
export type HandshakeOutcome =
  | { ok: true; peerPub: Uint8Array; ackFrame: Uint8Array; deviceToken: string | null }
  | { ok: false; errorFrame: Uint8Array; reason: string }

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * Process one client handshake frame.
 * @param frame - raw binary frame bytes.
 * @param deps - see {@link HandshakeDeps}.
 * @returns the outcome; the caller sends either frame (and stays seated on failure).
 */
export function hostHandshake(frame: Uint8Array, deps: HandshakeDeps): HandshakeOutcome {
  const fail = (reason: string): HandshakeOutcome => ({
    ok: false,
    errorFrame: encoder.encode(JSON.stringify({ error: reason })),
    reason,
  })

  if (frame.length < HANDSHAKE_PREFIX_BYTES + nacl.box.overheadLength + 2) return fail('bad-hello')
  const peerPub = frame.subarray(0, 32)
  const nonce = frame.subarray(32, HANDSHAKE_PREFIX_BYTES)
  const sealed = frame.subarray(HANDSHAKE_PREFIX_BYTES)
  const opened = nacl.box.open(sealed, nonce, peerPub, deps.keypair.secretKeyRaw)
  if (opened === null) return fail('bad-hello')

  let hello: { code?: unknown; deviceToken?: unknown; label?: unknown; clientType?: unknown }
  try {
    hello = JSON.parse(decoder.decode(opened)) as { code?: unknown; deviceToken?: unknown; label?: unknown; clientType?: unknown }
  } catch {
    return fail('bad-hello')
  }

  let deviceToken: string | null = null
  if (typeof hello.code === 'string') {
    const claimant = Buffer.from(peerPub).toString('base64url')
    const label = sanitizeDeviceLabel(hello.label)
    const clientType = parseClientType(hello.clientType)
    try {
      const claim = deps.offers.claim(hello.code, claimant, () => deps.devices.issue(label, deps.room, claimant, clientType).token, deps.room)
      if (claim.status !== 'ok') return fail(claim.status === 'expired' ? 'expired' : 'bad-code')
      deviceToken = claim.deviceToken
    } catch (error) {
      if (error instanceof DeviceLimitError) return fail('limit')
      throw error
    }
  } else if (typeof hello.deviceToken === 'string') {
    const claimant = Buffer.from(peerPub).toString('base64url')
    const device = deps.devices.authenticate(hello.deviceToken, claimant, deps.room)
    if (device === null) return fail('bad-token')
  } else {
    return fail('bad-hello')
  }

  const ackJson = deviceToken !== null ? { ok: true, deviceToken } : { ok: true }
  const ackNonce = nacl.randomBytes(nacl.box.nonceLength)
  const ack = nacl.box(encoder.encode(JSON.stringify(ackJson)), ackNonce, peerPub, deps.keypair.secretKeyRaw)
  const ackFrame = new Uint8Array(nacl.box.nonceLength + ack.length)
  ackFrame.set(ackNonce, 0)
  ackFrame.set(ack, nacl.box.nonceLength)
  return { ok: true, peerPub: new Uint8Array(peerPub), ackFrame, deviceToken }
}

function sanitizeDeviceLabel(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const label = value.replace(/[\0-\x1f]/g, '').trim().slice(0, 64)
  return label === '' ? undefined : label
}

function parseClientType(value: unknown): DeviceClientType | undefined {
  return value === 'android' || value === 'browser' ? value : undefined
}
