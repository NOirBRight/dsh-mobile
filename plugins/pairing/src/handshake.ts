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
 * helloJson is { code } | { deviceToken }. A valid code pairs a NEW device:
 * the ack carries { ok, deviceToken } — the token's only showing; the store
 * keeps its hash (protocol §5: permanent until revoked). Codes are multi-use
 * within their window (§1). A valid deviceToken reconnects an already-paired
 * device: ack is { ok }.
 */
import nacl from 'tweetnacl'
import type { DaemonKeypair } from './keys.ts'
import type { PairingOfferManager } from './pairing.ts'
import type { DeviceTokenStore } from './tokens.ts'

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

  let hello: { code?: unknown; deviceToken?: unknown }
  try {
    hello = JSON.parse(decoder.decode(opened)) as { code?: unknown; deviceToken?: unknown }
  } catch {
    return fail('bad-hello')
  }

  let deviceToken: string | null = null
  if (typeof hello.code === 'string') {
    // Multi-use within the pairing window (validate, not redeem): a lost ack
    // must not leave the phone with a burned code and no device token.
    const status = deps.offers.validate(hello.code)
    if (status !== 'ok') return fail(status === 'expired' ? 'expired' : 'bad-code')
    // New device: issue its permanent token (plaintext shows here only).
    deviceToken = deps.devices.issue(undefined, deps.room).token
  } else if (typeof hello.deviceToken === 'string') {
    const device = deps.devices.authenticate(hello.deviceToken)
    if (device === null) return fail('bad-token')
    // Re-bind to the room this handshake landed on: without it the new room's
    // campaign dies at window close and the phone times out forever (§5).
    if (deps.room !== undefined) deps.devices.bindRoom(device.id, deps.room)
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
