/**
 * Host side of the M3 tunnel handshake (docs/tunnel-protocol.md §2).
 *
 * Frame layouts (binary WS frames):
 *   client → host: clientPub(32B) || nonce(24B) || box(helloJson, hostPub, clientSec)
 *   host → client: nonce(24B) || box(ackJson, clientPub, hostSec)
 *   host → client on failure: PLAINTEXT error frame — a binary frame carrying
 *   raw JSON bytes {"error": ...}. The protocol's error vocabulary is
 *   "bad-code"|"expired"|…; this implementation uses bad-hello (unsealable /
 *   unparseable), bad-code (unknown or already burned), expired, bad-resume
 *   (unknown/burned resume token). Recorded in README §M3 interpretations.
 *
 * helloJson is { code } | { resumeToken }; ackJson is { ok: true, resumeToken }.
 * The ack's fresh resumeToken replaces whatever credential arrived — every
 * handshake burns its credential and mints the next one (protocol §5:
 * single-use, 10-minute TTL, in-memory).
 */
import { randomBytes } from 'node:crypto'
import nacl from 'tweetnacl'
import type { DaemonKeypair } from './keys.ts'
import type { PairingOfferManager } from './pairing.ts'

/** clientPub(32) || nonce(24) prefix length of a client handshake frame. */
export const HANDSHAKE_PREFIX_BYTES = 56

/** Protocol §5 default: resume tokens live 10 minutes. */
export const RESUME_TOKEN_TTL_MS = 600_000

/**
 * In-memory resume-token store. Single-use (redeem burns), TTL-bounded.
 * Process restart drops every token — the protocol explicitly accepts a
 * re-scan in that case (§5).
 */
export class ResumeTokenStore {
  private readonly ttlMs: number
  private readonly tokens = new Map<string, number>()

  /** @param ttlMs - token lifetime in milliseconds. */
  constructor(ttlMs: number = RESUME_TOKEN_TTL_MS) {
    this.ttlMs = ttlMs
  }

  /** @returns a fresh single-use token, valid for ttlMs. */
  mint(): string {
    this.prune()
    const token = randomBytes(32).toString('base64url')
    this.tokens.set(token, Date.now() + this.ttlMs)
    return token
  }

  /**
   * Burn a token and report whether it was still valid.
   * @param token - presented resume token.
   * @returns true only for a live, unexpired token.
   */
  redeem(token: string): boolean {
    const exp = this.tokens.get(token)
    if (exp === undefined) return false
    this.tokens.delete(token)
    return Date.now() <= exp
  }

  /** @returns epoch ms when the last live token expires; 0 when none live. */
  liveUntil(): number {
    this.prune()
    let max = 0
    for (const exp of this.tokens.values()) max = Math.max(max, exp)
    return max
  }

  private prune(): void {
    const now = Date.now()
    for (const [token, exp] of this.tokens) {
      if (now > exp) this.tokens.delete(token)
    }
  }
}

/** What the handshake needs: identity, one-time codes, and resume tokens. */
export interface HandshakeDeps {
  keypair: DaemonKeypair
  offers: PairingOfferManager
  resumeTokens: ResumeTokenStore
}

/** Handshake result: on success the sealed ack frame to send; on failure the plaintext error frame. */
export type HandshakeOutcome =
  | { ok: true; peerPub: Uint8Array; ackFrame: Uint8Array; resumeToken: string }
  | { ok: false; errorFrame: Uint8Array; reason: string }

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * Process one client handshake frame.
 * @param frame - raw binary frame bytes.
 * @param deps - see {@link HandshakeDeps}.
 * @returns the outcome; the caller sends either frame and closes on failure.
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

  let hello: { code?: unknown; resumeToken?: unknown }
  try {
    hello = JSON.parse(decoder.decode(opened)) as { code?: unknown; resumeToken?: unknown }
  } catch {
    return fail('bad-hello')
  }

  if (typeof hello.code === 'string') {
    const status = deps.offers.redeem(hello.code)
    if (status !== 'ok') return fail(status === 'expired' ? 'expired' : 'bad-code')
  } else if (typeof hello.resumeToken === 'string') {
    if (!deps.resumeTokens.redeem(hello.resumeToken)) return fail('bad-resume')
  } else {
    return fail('bad-hello')
  }

  const resumeToken = deps.resumeTokens.mint()
  const ackNonce = nacl.randomBytes(nacl.box.nonceLength)
  const ack = nacl.box(encoder.encode(JSON.stringify({ ok: true, resumeToken })), ackNonce, peerPub, deps.keypair.secretKeyRaw)
  const ackFrame = new Uint8Array(nacl.box.nonceLength + ack.length)
  ackFrame.set(ackNonce, 0)
  ackFrame.set(ack, nacl.box.nonceLength)
  return { ok: true, peerPub: new Uint8Array(peerPub), ackFrame, resumeToken }
}
