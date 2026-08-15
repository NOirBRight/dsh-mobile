/**
 * Pairing offer minting and exchange. An offer binds a one-time code to the
 * daemon's current reachability answer (mode/addr/room) and public key; the
 * QR carries the offer inside a URL fragment, which browsers never send to
 * any server (Paseo's #offer=... pattern).
 */
import { randomBytes } from 'node:crypto'

/** The QR payload. `v` 1 = LAN (M1), 2 = relay (tunnel-protocol.md §1). `room` is null in LAN mode; `exp` is epoch SECONDS (wire contract, tunnel-protocol.md §1). */
export interface PairingOfferPayload {
  v: 1 | 2
  mode: 'lan' | 'relay'
  addr: string
  room: string | null
  pubkey: string
  code: string
  exp: number
}

/** Mints one-time, short-lived pairing codes; state is deliberately in-memory (restart rotates). */
export class PairingOfferManager {
  private readonly pending = new Map<string, number>()
  private readonly ttlMs: number

  /** @param ttlMs - code lifetime in milliseconds. */
  constructor(ttlMs: number) {
    this.ttlMs = ttlMs
  }

  /**
   * Mint an offer with a fresh one-time code.
   * @param mode - connection mode the addr describes.
   * @param addr - reachability address (LAN URL or relay WSS URL).
   * @param room - relay room id, null in LAN mode.
   * @param pubkey - daemon Curve25519 public key, base64url.
   * @returns the payload to embed in the QR.
   */
  mint(mode: 'lan' | 'relay', addr: string, room: string | null, pubkey: string): PairingOfferPayload {
    this.prune()
    const code = randomBytes(24).toString('base64url')
    const expMs = Date.now() + this.ttlMs
    this.pending.set(code, expMs)
    // Wire field is unix SECONDS (tunnel-protocol.md §1); the pending map keeps ms.
    return { v: mode === 'relay' ? 2 : 1, mode, addr, room, pubkey, code, exp: Math.floor(expMs / 1000) }
  }

  /**
   * Burn a code and report the outcome distinctly — the tunnel handshake
   * needs the expired/unknown split for its plaintext error frame (§2.2).
   * One-time: a presented code is consumed whether or not it has expired.
   * @param code - the code from an offer payload.
   * @returns the redemption outcome.
   */
  redeem(code: string): 'ok' | 'expired' | 'unknown' {
    const exp = this.pending.get(code)
    if (exp === undefined) return 'unknown'
    this.pending.delete(code)
    return Date.now() <= exp ? 'ok' : 'expired'
  }

  /**
   * Burn a code and report whether it was still valid. One-time: a presented
   * code is consumed whether or not it has expired.
   * @param code - the code from an offer payload.
   * @returns true only for a live, unexpired code.
   */
  exchange(code: string): boolean {
    return this.redeem(code) === 'ok'
  }

  private prune(): void {
    const now = Date.now()
    for (const [code, exp] of this.pending) {
      if (now > exp) this.pending.delete(code)
    }
  }
}

/**
 * Render an offer as the QR target URL; the payload rides the fragment.
 * @param appUrl - mobile shell base URL (any existing fragment is replaced).
 * @param offer - the minted payload.
 * @returns `<appUrl>#offer=<base64url(JSON)>`.
 */
export function buildOfferUrl(appUrl: string, offer: PairingOfferPayload): string {
  const base = appUrl.split('#')[0]
  return `${base}#offer=${Buffer.from(JSON.stringify(offer)).toString('base64url')}`
}

/**
 * Parse an offer URL back into its payload (test and mobile-shell side).
 * @param url - a URL produced by {@link buildOfferUrl}.
 * @returns the payload, or null when the URL carries no well-formed offer.
 */
export function parseOfferUrl(url: string): PairingOfferPayload | null {
  const hash = new URL(url).hash
  if (!hash.startsWith('#offer=')) return null
  try {
    const payload = JSON.parse(Buffer.from(hash.slice('#offer='.length), 'base64url').toString()) as PairingOfferPayload
    if (payload.v !== 1 && payload.v !== 2) return null
    if (typeof payload.code !== 'string' || typeof payload.pubkey !== 'string') return null
    if (payload.v === 2 && (payload.mode !== 'relay' || typeof payload.room !== 'string')) return null
    return payload
  } catch {
    return null
  }
}
