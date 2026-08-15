import { b64urlDecode } from './bytes.ts'
import { TunnelError } from './errors.ts'

/** Parsed pairing offer (tunnel-protocol.md §1). */
export interface Offer {
  /** Protocol version; only 2 is accepted. */
  v: 2
  /** Only 'relay' mode exists in M3. */
  mode: 'relay'
  /** Relay base URL, e.g. wss://relay.noirbright.top */
  addr: string
  /** Relay room id (128-bit hex). */
  room: string
  /** Host X25519 public key, base64url — the pairing trust anchor. */
  pubkey: string
  /** One-time pairing code. */
  code: string
  /** Expiry, unix seconds. */
  exp: number
}

export interface ParseOfferOptions {
  /** Permit an expired pairing window when a caller has a persistent device token. */
  allowExpired?: boolean
}

/**
 * Parse and validate an offer. Accepts a full URL with an '#offer=<base64url>'
 * fragment or a bare base64url payload.
 * @param offerUrl QR content or bare payload.
 * @param options Validation policy; token reconnects may outlive the QR window.
 * @returns the validated offer.
 * @throws TunnelError 'bad-offer' (malformed) or 'expired' (past exp).
 */
export function parseOffer(offerUrl: string, options: ParseOfferOptions = {}): Offer {
  const match = /#offer=([A-Za-z0-9_-]+)/.exec(offerUrl)
  const payload = match ? match[1] : offerUrl.trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(b64urlDecode(payload)))
  } catch {
    throw new TunnelError('bad-offer', 'offer payload is not base64url JSON')
  }
  const o = parsed as Record<string, unknown>
  if (o === null || typeof o !== 'object') throw new TunnelError('bad-offer', 'offer is not an object')
  if (o.v !== 2) throw new TunnelError('bad-offer', 'unsupported offer version')
  if (o.mode !== 'relay') throw new TunnelError('bad-offer', 'only relay mode is supported')
  if (typeof o.addr !== 'string' || !/^wss?:\/\//.test(o.addr)) throw new TunnelError('bad-offer', 'addr must be a ws(s) URL')
  if (typeof o.room !== 'string' || !/^[0-9a-f]{32}$/.test(o.room)) throw new TunnelError('bad-offer', 'room must be 128-bit hex')
  if (typeof o.pubkey !== 'string') throw new TunnelError('bad-offer', 'missing pubkey')
  try {
    if (b64urlDecode(o.pubkey).length !== 32) throw new Error()
  } catch {
    throw new TunnelError('bad-offer', 'pubkey must be 32 bytes, base64url')
  }
  if (typeof o.code !== 'string' || o.code.length === 0) throw new TunnelError('bad-offer', 'missing code')
  if (typeof o.exp !== 'number' || !Number.isFinite(o.exp)) throw new TunnelError('bad-offer', 'missing exp')
  if (!options.allowExpired && o.exp * 1000 <= Date.now()) throw new TunnelError('expired', 'offer has expired; rescan the QR code')
  return { v: 2, mode: 'relay', addr: o.addr, room: o.room, pubkey: o.pubkey, code: o.code, exp: o.exp }
}
