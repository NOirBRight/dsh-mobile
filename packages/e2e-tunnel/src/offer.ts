import { b64urlDecode } from './bytes.ts'
import { TunnelError } from './errors.ts'
import { compactDisplayName } from './display-name.ts'

/** Shared offer fields (tunnel-protocol.md §1). */
interface OfferBase {
  /** Reachability address: relay WSS base (v2) or signaling WSS URL (v3). */
  addr: string
  /** Room id (128-bit hex) on the relay/signaling server. */
  room: string
  /** Host X25519 public key, base64url — the pairing trust anchor. */
  pubkey: string
  /** One-time pairing code. */
  code: string
  /** Expiry, unix seconds. */
  exp: number
  /** Human-facing Host name; presentation metadata, never endpoint or Room identity. */
  hostName?: string
}

/** v2: traffic rides the relay room (NaCl-sealed frames over the room WebSocket). */
export interface RelayOffer extends OfferBase {
  v: 2
  mode: 'relay'
}

/**
 * v3: the room is signaling-only (SDP/ICE exchange); traffic rides a WebRTC
 * DataChannel brought up out-of-band and handed to openSession. ice lists
 * STUN servers only — never TURN: there is no relay fallback by design, and
 * a TURN URL would smuggle one in.
 */
export interface DirectOffer extends OfferBase {
  v: 3
  mode: 'direct'
  /** STUN server URLs (stun:/stuns:); optional — host candidates suffice on shared-LAN paths. */
  ice?: string[]
}

/** Capabilities advertised by one Host-owned Public Endpoint. */
export interface PublicEndpointCapabilities {
  browser: boolean
  direct: boolean
  tunnel: boolean
  endpointRefresh: boolean
}

/** v4: one Host-owned HTTPS endpoint provides rendezvous and optional tunnel fallback. */
export interface PublicEndpointOffer {
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
  /** Human-facing Host name available immediately after scanning. */
  hostName?: string
  /** STUN-only ICE discovery; Tunnel Fallback is the non-direct path. */
  ice?: string[]
}

/** Parsed pairing offer (tunnel-protocol.md §1). */
export type Offer = RelayOffer | DirectOffer | PublicEndpointOffer

export interface ParseOfferOptions {
  /** Permit an expired pairing window when a caller has a persistent device token. */
  allowExpired?: boolean
}

/** STUN-only ICE server URL (RFC 7064: stun:host[:port]; the // form is also accepted). */
const STUN_URL = /^stuns?:(\/\/)?/

/**
 * Parse and validate an offer. Accepts a full URL with an '#offer=<base64url>'
 * fragment or a bare base64url payload. v2 requires mode 'relay', v3 requires
 * mode 'direct' with a STUN-only ice list — anything else is rejected, never
 * coerced.
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
  if (Array.isArray(parsed)) {
    const [version, endpoint, kind, room, pubkey, code, exp, capabilityMask, ice, hostName] = parsed
    const mask = typeof capabilityMask === 'number' && Number.isInteger(capabilityMask) && capabilityMask >= 0 && capabilityMask <= 15
      ? capabilityMask
      : null
    const compactIce = ice === null ? undefined : ice
    parsed = {
      v: version, mode: 'public', protocol: 1, endpoint,
      endpointKind: kind === 0 ? 'temporary' : kind === 1 ? 'custom' : undefined,
      room, pubkey, code, exp,
      capabilities: mask === null ? null : {
        browser: (mask & 1) !== 0, direct: (mask & 2) !== 0,
        tunnel: (mask & 4) !== 0, endpointRefresh: (mask & 8) !== 0,
      },
      ...(compactIce === undefined ? {} : { ice: compactIce }),
      ...(hostName === undefined ? {} : { hostName }),
    }
  }
  const o = parsed as Record<string, unknown>
  if (o === null || typeof o !== 'object') throw new TunnelError('bad-offer', 'offer is not an object')
  if (o.v !== 2 && o.v !== 3 && o.v !== 4) throw new TunnelError('bad-offer', 'unsupported offer version')
  const expectedMode = o.v === 2 ? 'relay' : o.v === 3 ? 'direct' : 'public'
  if (o.mode !== expectedMode) throw new TunnelError('bad-offer', 'v' + o.v + " offers must use mode '" + expectedMode + "'")
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

  const hostName = o.hostName === undefined
    ? undefined
    : typeof o.hostName === 'string'
      ? o.hostName.replace(/[\u0000-\u001f\u007f]/g, '').trim() === ''
        ? null
        : compactDisplayName(o.hostName, 'Host')
      : null
  if (hostName === null || (o.hostName !== undefined && hostName === '')) throw new TunnelError('bad-offer', 'hostName must be a non-empty string')

  const validateIce = (): string[] | undefined => {
    if (o.ice === undefined) return undefined
    if (!Array.isArray(o.ice) || o.ice.some((url) => typeof url !== 'string' || !STUN_URL.test(url))) {
      throw new TunnelError('bad-offer', 'ice must be an array of stun:/stuns: URLs (TURN is never accepted)')
    }
    return o.ice as string[]
  }

  if (o.v === 4) {
    if (o.protocol !== 1) throw new TunnelError('bad-offer', 'unsupported public endpoint protocol')
    if (typeof o.endpoint !== 'string') throw new TunnelError('bad-offer', 'missing public endpoint')
    try {
      const endpoint = new URL(o.endpoint)
      if (endpoint.protocol !== 'https:' || endpoint.username !== '' || endpoint.password !== '') throw new Error()
    } catch {
      throw new TunnelError('bad-offer', 'public endpoint must be an HTTPS URL without credentials')
    }
    if (o.endpointKind !== 'temporary' && o.endpointKind !== 'custom') {
      throw new TunnelError('bad-offer', 'endpointKind must be temporary or custom')
    }
    if (o.capabilities === null || typeof o.capabilities !== 'object' || Array.isArray(o.capabilities)) {
      throw new TunnelError('bad-offer', 'missing public endpoint capabilities')
    }
    const capabilities = o.capabilities as Record<string, unknown>
    for (const key of ['browser', 'direct', 'tunnel', 'endpointRefresh']) {
      if (typeof capabilities[key] !== 'boolean') throw new TunnelError('bad-offer', 'public endpoint capabilities must be boolean')
    }
    if (capabilities.browser !== false) throw new TunnelError('incompatible', 'public endpoint offers are APK-only')
    const common = { room: o.room, pubkey: o.pubkey, code: o.code, exp: o.exp, ...(hostName === undefined ? {} : { hostName }) }
    const ice = validateIce()
    return {
      ...common, v: 4, mode: 'public', protocol: 1, endpoint: o.endpoint, endpointKind: o.endpointKind,
      capabilities: capabilities as unknown as PublicEndpointCapabilities, ...(ice === undefined ? {} : { ice }),
    }
  }

  if (typeof o.addr !== 'string' || !/^wss?:\/\//.test(o.addr)) throw new TunnelError('bad-offer', 'addr must be a ws(s) URL')
  try {
    const address = new URL(o.addr)
    const localDevelopment = address.protocol === 'ws:' && (address.hostname === 'localhost' || address.hostname === '127.0.0.1' || address.hostname === '[::1]')
    if (address.username !== '' || address.password !== '' || address.search !== '' || address.hash !== '' || (o.v === 2 && address.protocol !== 'wss:' && !localDevelopment)) throw new Error()
  } catch {
    throw new TunnelError('bad-offer', o.v === 2 ? 'official Relay address must be WSS without credentials' : 'addr must be a credential-free WebSocket URL')
  }
  const base: OfferBase = { addr: o.addr, room: o.room, pubkey: o.pubkey, code: o.code, exp: o.exp, ...(hostName === undefined ? {} : { hostName }) }
  if (o.v === 2) {
    if (o.ice !== undefined) throw new TunnelError('bad-offer', 'ice is only valid on direct or public offers')
    return { ...base, v: 2, mode: 'relay' }
  }
  const ice = validateIce()
  return { ...base, v: 3, mode: 'direct', ...(ice === undefined ? {} : { ice }) }
}
