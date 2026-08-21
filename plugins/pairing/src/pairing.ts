/**
 * Pairing offer minting and exchange. An offer binds a one-time code to the
 * daemon's current reachability answer (mode/addr/room) and public key; the
 * QR carries the offer inside a URL fragment, which browsers never send to
 * any server (Paseo's #offer=... pattern).
 */
import { randomBytes } from 'node:crypto'

/** Legacy QR payloads retained only for migration and compatibility. */
export interface LegacyPairingOfferPayload {
  v: 1 | 2 | 3
  mode: 'lan' | 'relay' | 'direct'
  addr: string
  room: string | null
  pubkey: string
  code: string
  exp: number
  /** STUN discovery URLs; TURN is deliberately forbidden in direct mode. */
  ice?: string[]
}

export interface PublicEndpointCapabilities {
  browser: boolean
  direct: boolean
  tunnel: boolean
  endpointRefresh: boolean
}

/** Current Host-owned Public Endpoint QR payload. */
export interface PublicPairingOfferPayload {
  v: 4
  mode: 'public'
  protocol: 1
  endpoint: string
  endpointKind: 'temporary' | 'custom'
  room: string
  pubkey: string
  code: string
  exp: number
  capabilities: PublicEndpointCapabilities
  ice?: string[]
}

export type PairingOfferPayload = LegacyPairingOfferPayload | PublicPairingOfferPayload

export interface MintPublicOfferOptions {
  endpoint: string
  endpointKind: 'temporary' | 'custom'
  room: string
  pubkey: string
  ice?: string[]
  capabilities?: Partial<PublicEndpointCapabilities>
}

const PUBLIC_CAPABILITIES: PublicEndpointCapabilities = {
  browser: false,
  direct: true,
  tunnel: true,
  endpointRefresh: true,
}
const STUN_URL = /^stuns?:(\/\/)?/i

interface PendingOffer {
  expMs: number
  room?: string
  claim?: { claimant: string; deviceToken: string }
}

export type PairingClaimOutcome =
  | { status: 'ok'; deviceToken: string }
  | { status: 'expired' | 'unknown' }

/** Mints one-time, short-lived pairing codes; state is deliberately in-memory (restart rotates). */
export class PairingOfferManager {
  private readonly pending = new Map<string, PendingOffer>()
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
  mint(
    mode: 'lan' | 'relay' | 'direct',
    addr: string,
    room: string | null,
    pubkey: string,
    ice?: string[],
  ): PairingOfferPayload {
    if (mode === 'direct') {
      if (room === null) throw new Error('direct pairing requires a signaling room')
      if (ice === undefined || ice.some(url => !url.toLowerCase().startsWith('stun:'))) {
        throw new Error('direct pairing requires STUN-only ICE URLs')
      }
    }
    this.prune()
    const code = randomBytes(24).toString('base64url')
    const expMs = Date.now() + this.ttlMs
    this.pending.set(code, room === null ? { expMs } : { expMs, room })
    const v = mode === 'direct' ? 3 : mode === 'relay' ? 2 : 1
    return { v, mode, addr, room, pubkey, code, exp: Math.floor(expMs / 1000), ...(mode === 'direct' ? { ice } : {}) }
  }

  /** Mint the current Host-owned Public Endpoint offer. */
  mintPublic(options: MintPublicOfferOptions): PublicPairingOfferPayload {
    let endpoint: URL
    try {
      endpoint = new URL(options.endpoint)
    } catch {
      throw new Error('public endpoint must be an HTTPS URL')
    }
    if (endpoint.protocol !== 'https:' || endpoint.username !== '' || endpoint.password !== '') {
      throw new Error('public endpoint must be an HTTPS URL without credentials')
    }
    if (!/^[0-9a-f]{32}$/.test(options.room)) throw new Error('public endpoint pairing requires a 128-bit room')
    if (options.ice !== undefined && options.ice.some(url => !STUN_URL.test(url))) {
      throw new Error('public endpoint pairing requires STUN-only ICE URLs')
    }
    this.prune()
    const code = randomBytes(24).toString('base64url')
    const expMs = Date.now() + this.ttlMs
    this.pending.set(code, { expMs, room: options.room })
    return {
      v: 4, mode: 'public', protocol: 1, endpoint: options.endpoint, endpointKind: options.endpointKind,
      room: options.room, pubkey: options.pubkey, code, exp: Math.floor(expMs / 1000),
      capabilities: { ...PUBLIC_CAPABILITIES, ...options.capabilities, browser: false },
      ...(options.ice === undefined ? {} : { ice: options.ice }),
    }
  }

  /**
   * Burn a code and report the outcome distinctly — the tunnel handshake
   * needs the expired/unknown split for its plaintext error frame (§2.2).
   * One-time: a presented code is consumed whether or not it has expired.
   * @param code - the code from an offer payload.
   * @returns the redemption outcome.
   */
  redeem(code: string): 'ok' | 'expired' | 'unknown' {
    const pending = this.pending.get(code)
    if (pending === undefined || pending.claim !== undefined) return 'unknown'
    this.pending.delete(code)
    return Date.now() <= pending.expMs ? 'ok' : 'expired'
  }

  /** Inspect an unclaimed code without consuming it. */
  validate(code: string): 'ok' | 'expired' | 'unknown' {
    const pending = this.pending.get(code)
    if (pending === undefined || pending.claim !== undefined) return 'unknown'
    return Date.now() <= pending.expMs ? 'ok' : 'expired'
  }

  /**
   * Atomically claim a code for one Client Instance. A retry from the same
   * public key receives the same transient token; every other client is
   * rejected. This keeps the offer single-use without making ACK loss fatal.
   */
  claim(code: string, claimant: string, issue: () => string, room?: string): PairingClaimOutcome {
    const pending = this.pending.get(code)
    if (pending === undefined) return { status: 'unknown' }
    if (pending.room !== undefined && pending.room !== room) return { status: 'unknown' }
    if (Date.now() > pending.expMs) return { status: 'expired' }
    if (pending.claim !== undefined) {
      return pending.claim.claimant === claimant
        ? { status: 'ok', deviceToken: pending.claim.deviceToken }
        : { status: 'unknown' }
    }
    const deviceToken = issue()
    pending.claim = { claimant, deviceToken }
    return { status: 'ok', deviceToken }
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
    for (const [code, pending] of this.pending) {
      if (now > pending.expMs) this.pending.delete(code)
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

/** Compact v4 wire form keeps dense camera QR codes below the known-good v3 size. */
export function buildCompactPublicOfferUrl(appUrl: string, offer: PublicPairingOfferPayload): string {
  const capabilities = offer.capabilities
  const mask = (capabilities.browser ? 1 : 0) | (capabilities.direct ? 2 : 0)
    | (capabilities.tunnel ? 4 : 0) | (capabilities.endpointRefresh ? 8 : 0)
  const payload = [
    4, offer.endpoint, offer.endpointKind === 'custom' ? 1 : 0, offer.room,
    offer.pubkey, offer.code, offer.exp, mask, ...(offer.ice === undefined ? [] : [offer.ice]),
  ]
  return `${appUrl.split('#')[0]}#offer=${Buffer.from(JSON.stringify(payload)).toString('base64url')}`
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
    if (payload.v !== 1 && payload.v !== 2 && payload.v !== 3 && payload.v !== 4) return null
    if (typeof payload.code !== 'string' || typeof payload.pubkey !== 'string') return null
    if (payload.v === 2 && (payload.mode !== 'relay' || typeof payload.room !== 'string')) return null
    if (payload.v === 3 && (
      payload.mode !== 'direct' || typeof payload.room !== 'string' ||
      !Array.isArray(payload.ice) || payload.ice.some(url => typeof url !== 'string' || !STUN_URL.test(url))
    )) return null
    if (payload.v === 4) {
      if (payload.mode !== 'public' || payload.protocol !== 1 || typeof payload.room !== 'string') return null
      if (payload.endpointKind !== 'temporary' && payload.endpointKind !== 'custom') return null
      try {
        if (new URL(payload.endpoint).protocol !== 'https:') return null
      } catch {
        return null
      }
      if (payload.capabilities === null || typeof payload.capabilities !== 'object') return null
      for (const key of ['browser', 'direct', 'tunnel', 'endpointRefresh'] as const) {
        if (typeof payload.capabilities[key] !== 'boolean') return null
      }
      if (payload.ice !== undefined && (!Array.isArray(payload.ice) || payload.ice.some(url => typeof url !== 'string' || !STUN_URL.test(url)))) return null
    }
    return payload
  } catch {
    return null
  }
}
