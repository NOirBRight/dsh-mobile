import nacl from 'tweetnacl'
import { b64urlDecode, concat, utf8Decode, utf8Encode } from './bytes.ts'
import { DEFAULT_MAX_HTTP_BODY_BYTES, TunnelError } from './errors.ts'
import { compactDisplayName } from './display-name.ts'
import { parseOffer, type Offer, type RelayOffer, type DirectOffer, type PublicEndpointOffer } from './offer.ts'
import type { ConnectionPolicy } from './connection-policy.ts'
import { ConnectionCoordinator, type ConnectionStatus } from './connection-manager.ts'
import { TunnelWebSocket } from './socket.ts'
import { tunnelFetch, type PendingFetch } from './http.ts'
import { DataChannelTransport, WsFrameTransport, type FrameTransport } from './transport.ts'
import { negotiateDirectChannel, type NegotiatedChannel } from './signal.ts'

/** Tunnel lifecycle, surfaced to the app badge. */
export type TunnelState = 'connecting' | 'open' | 'closed'

export interface ClientKeypair {
  publicKey: Uint8Array
  secretKey: Uint8Array
}

export function generateClientKeypair(): ClientKeypair {
  const generated = nacl.box.keyPair()
  return { publicKey: generated.publicKey.slice(), secretKey: generated.secretKey.slice() }
}

export interface ConnectOptions {
  /** Stable Client Instance key used to make one-time-offer retries idempotent. */
  clientKeypair?: ClientKeypair
  /** Persistent device token from a previous pairing (permanent until revoked, protocol §5). */
  deviceToken?: string
  /** Called with the device token when one is issued (first pairing only — store it). */
  onDeviceToken?: (token: string) => void | Promise<void>
  /** Called after every sealed acknowledgement carrying mutable Host presentation metadata. */
  onHostMetadata?: (metadata: { displayName: string }) => void | Promise<void>
  /** Called on every state transition. */
  onStateChange?: (state: TunnelState) => void
  /** Public Endpoint policy; Automatic is the product default. */
  connectionPolicy?: ConnectionPolicy
  /** Visible Public Endpoint route and phase changes. */
  onConnectionStatus?: (status: ConnectionStatus) => void
  /** Handshake wait bound; default 10_000 ms. */
  handshakeTimeoutMs?: number
  /** Transport-level reconnect attempts (roaming/4409 races); default 3. */
  connectRetries?: number
  /** Optional Host-facing device label stored on first pairing. */
  deviceLabel?: string
  /** Optional Client Instance type stored on first pairing. */
  clientType?: 'android' | 'browser'
}

/** openSession inputs: the connection callbacks plus the pairing credential the hello presents. */
export interface OpenSessionOptions extends ConnectOptions {
  /** One-time pairing code from the offer; required unless deviceToken is presented. */
  code?: string
}

/** Live tunnel: multiplexed fetch + WebSocket over one sealed WSS room. */
export interface TunnelClient {
  /** Tunneled fetch; path is origin-relative (e.g. /api/host.describe). */
  fetch(path: string, init?: {
    method?: string
    headers?: HeadersInit
    body?: string | ArrayBuffer | Uint8Array | Blob | URLSearchParams | ReadableStream<Uint8Array> | null
    signal?: AbortSignal | null
  }): Promise<Response>
  /** Open a tunneled WebSocket to a loopback path (e.g. /api/remote.mux). */
  openWebSocket(path: string): TunnelWebSocket
  /** Probe application-level liveness inside the encrypted session. */
  probe(timeoutMs?: number): Promise<void>
  /** The device token this session runs on (permanent until revoked, protocol §5). */
  readonly deviceToken: string | null
  /** Negotiated HTTP body cap; Host advertises, client defaults to 8 MiB. */
  readonly maxHttpBodyBytes: number
  readonly state: TunnelState
  close(): void
  /** Close without emitting onStateChange. Used when this session lost the Automatic race. */
  discard(): void
}

interface WireMessage {
  t: string
  id?: string
  seq?: number
  [key: string]: unknown
}

const PLAINTEXT_LIMIT = 200 * 1024

/**
 * Pair and connect: parse the offer, establish the transport the offer's
 * mode names, run the sealed handshake (tunnel-protocol.md section 2) over
 * it, and return the live session. v2 'relay': all frames ride the room
 * WebSocket. v3 'direct': the room socket carries only the SDP exchange,
 * a WebRTC DataChannel is negotiated (non-trickle, STUN-only, no fallback),
 * the signaling socket is closed, and the same handshake runs over the
 * channel — the VPS never sees a handshake or application frame.
 * @param offerUrl QR content (URL with #offer= fragment or bare payload).
 * @param options resumeToken/callbacks/timeout.
 * @returns the open TunnelClient.
 * @throws TunnelError 'bad-offer' | 'expired' | 'bad-code' (host-rejected code/token) | 'handshake' | 'timeout' | 'ice-failed' (direct mode only; no TURN fallback exists).
 */
export async function connect(offerUrl: string, options: ConnectOptions = {}): Promise<TunnelClient> {
  options.onStateChange?.('connecting')
  try {
    // A paired device's persistent token outlives the short QR window.
    // Still parse the offer shape, but let the host authenticate the token.
    const offer = parseOffer(offerUrl, { allowExpired: options.deviceToken !== undefined })
    const hostPub = b64urlDecode(offer.pubkey)
    const maxAttempts = Math.max(1, options.connectRetries ?? 3)
    for (let attempt = 1; ; attempt++) {
      try {
        if (offer.mode === 'relay') return await attemptConnect(offer, hostPub, options)
        if (offer.mode === 'direct') return await attemptDirectConnect(offer, hostPub, options)
        return await attemptPublicEndpoint(offer, hostPub, options)
      } catch (error) {
        // Roaming reconnects can reach the relay while it still seats the
        // previous client (4409 close before any frame); only transport-level
        // handshake failures retry — host verdicts (bad-code/expired) are final.
        if (!(error instanceof TunnelError) || error.code !== 'handshake' || attempt >= maxAttempts) throw error
        await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** (attempt - 1)))
      }
    }
  } catch (error) {
    options.onStateChange?.('closed')
    throw error
  }
}

/** Build a bounded WSS route under the advertised HTTPS Gateway base path. */
export function publicEndpointSocketUrl(endpoint: string, route: 'signal' | 'tunnel', room: string): string {
  const url = new URL(endpoint)
  if (url.protocol !== 'https:') throw new TunnelError('bad-offer', 'Public Endpoint must use HTTPS')
  if (!/^[0-9a-f]{32}$/.test(room)) throw new TunnelError('bad-offer', 'invalid Public Endpoint room')
  url.protocol = 'wss:'
  url.username = ''
  url.password = ''
  url.search = ''
  url.hash = ''
  url.pathname = url.pathname.replace(/\/$/, '') + `/${route}/${room}`
  return url.toString()
}

async function attemptPublicEndpoint(offer: PublicEndpointOffer, hostPub: Uint8Array, options: ConnectOptions): Promise<TunnelClient> {
  const coordinator = new ConnectionCoordinator({
    policy: options.connectionPolicy ?? 'automatic',
    capabilities: { direct: offer.capabilities.direct, tunnel: offer.capabilities.tunnel },
    connectDirect: signal => attemptPublicDirect(offer, hostPub, options, signal),
    connectTunnel: signal => attemptPublicTunnel(offer, hostPub, options, signal),
    onState: options.onConnectionStatus,
  })
  return coordinator.connect()
}

async function attemptPublicTunnel(offer: PublicEndpointOffer, hostPub: Uint8Array, options: ConnectOptions, signal?: AbortSignal): Promise<TunnelClient> {
  const ws = new WebSocket(publicEndpointSocketUrl(offer.endpoint, 'tunnel', offer.room))
  ws.binaryType = 'arraybuffer'
  const transport = new WsFrameTransport(ws)
  const onAbort = (): void => { try { transport.close(1000) } catch { /* already gone */ } }
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    if (signal?.aborted) throw new TunnelError('closed', 'connection aborted')
    await onceOpen(ws, 10_000, signal)
    return await openSession(transport, hostPub, { ...options, code: offer.code })
  } catch (error) {
    try { transport.close(1000) } catch { /* already gone */ }
    throw error
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}

async function attemptPublicDirect(offer: PublicEndpointOffer, hostPub: Uint8Array, options: ConnectOptions, signal?: AbortSignal): Promise<TunnelClient> {
  const ws = new WebSocket(publicEndpointSocketUrl(offer.endpoint, 'signal', offer.room))
  ws.binaryType = 'arraybuffer'
  let negotiated: NegotiatedChannel | null = null
  const teardown = (): void => {
    negotiated?.closePeer()
    try { ws.close(1000) } catch { /* already gone */ }
  }
  const onAbort = (): void => { teardown() }
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    if (signal?.aborted) throw new TunnelError('closed', 'connection aborted')
    await onceOpen(ws, 10_000, signal)
    negotiated = await negotiateDirectChannel(ws, { ice: offer.ice, timeoutMs: options.handshakeTimeoutMs })
    const onStateChange = options.onStateChange
    return await openSession(new DataChannelTransport(negotiated.channel), hostPub, {
      ...options,
      code: offer.code,
      onStateChange: (state) => {
        if (state === 'closed') teardown()
        onStateChange?.(state)
      },
    })
  } catch (error) {
    teardown()
    throw error
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}

async function attemptConnect(offer: RelayOffer, hostPub: Uint8Array, options: ConnectOptions): Promise<TunnelClient> {
  options.onConnectionStatus?.({ phase: 'tunnel-connecting', route: 'tunnel' })
  const ws = new WebSocket(offer.addr + '/r/' + offer.room + '?role=client')
  ws.binaryType = 'arraybuffer'
  const transport = new WsFrameTransport(ws)
  try {
    await onceOpen(ws)
    const client = await openSession(transport, hostPub, { ...options, code: offer.code })
    options.onConnectionStatus?.({ phase: 'tunnel-open', route: 'tunnel' })
    return client
  } catch (error) {
    // A rejected/failed attempt must release the room seat (one client per
    // room); the host stays seated and never closes on a bad hello.
    try { transport.close(1000) } catch { /* already gone */ }
    throw error
  }
}

/**
 * One v3 'direct' attempt: join the room for signaling only, negotiate the
 * DataChannel, then run the unchanged sealed handshake over the channel.
 * The signaling socket stays open while the peer lives (renegotiation /
 * ICE-restart channel); peer connection AND signaling socket are closed
 * together when the tunnel closes or the attempt fails. No binary frame
 * ever touches the signaling socket — the NaCl hello and all session
 * traffic ride the DataChannel, so the VPS carries SDP and nothing else.
 */
async function attemptDirectConnect(offer: DirectOffer, hostPub: Uint8Array, options: ConnectOptions): Promise<TunnelClient> {
  const ws = new WebSocket(offer.addr + '/r/' + offer.room + '?role=client')
  ws.binaryType = 'arraybuffer'
  const teardown = (negotiated: NegotiatedChannel | null): void => {
    if (negotiated !== null) negotiated.closePeer()
    try { ws.close(1000) } catch { /* already gone */ }
  }
  let negotiated: NegotiatedChannel | null = null
  try {
    await onceOpen(ws)
    negotiated = await negotiateDirectChannel(ws, { ice: offer.ice, timeoutMs: options.handshakeTimeoutMs })
    // Tie lifetimes: tunnel close (local teardown, protocol violation, or a
    // dead DataChannel) closes the peer connection and the signaling socket.
    const onStateChange = options.onStateChange
    const session = await openSession(new DataChannelTransport(negotiated.channel), hostPub, {
      ...options,
      code: offer.code,
      onStateChange: (state) => {
        if (state === 'closed') teardown(negotiated)
        onStateChange?.(state)
      },
    })
    return session
  } catch (error) {
    teardown(negotiated)
    throw error
  }
}

/**
 * Run the sealed handshake (tunnel-protocol.md §2) over any already-open
 * frame transport and return the live session. This is the factory a
 * separately established channel (e.g. a WebRTC DataChannel brought up by
 * out-of-band signaling) uses to construct a TunnelSession: the caller owns
 * transport setup and teardown-on-failure, this package owns the pairing
 * credential exchange and everything above it.
 * @param transport open, reliable, ordered frame pipe (see transport.ts).
 * @param hostPub host X25519 public key — the pairing trust anchor from the offer.
 * @param options code or deviceToken (the hello credential), callbacks, timeout.
 * @returns the open TunnelClient.
 * @throws TunnelError host verdict codes | 'handshake' | 'timeout'.
 */
export async function openSession(transport: FrameTransport, hostPub: Uint8Array, options: OpenSessionOptions = {}): Promise<TunnelClient> {
  const sourceKeys = options.clientKeypair ?? generateClientKeypair()
  if (sourceKeys.publicKey.length !== nacl.box.publicKeyLength || sourceKeys.secretKey.length !== nacl.box.secretKeyLength) {
    throw new TunnelError('bad-key', 'Client Instance keypair must be X25519')
  }
  // Own session copies so callers may wipe transient vault material after connect().
  const keys = { publicKey: sourceKeys.publicKey.slice(), secretKey: sourceKeys.secretKey.slice() }
  const presentation = {
    ...(options.deviceLabel === undefined || options.deviceLabel.trim() === '' ? {} : { label: options.deviceLabel.trim().slice(0, 64) }),
    ...(options.clientType === 'android' || options.clientType === 'browser' ? { clientType: options.clientType } : {}),
  }
  const hello = options.deviceToken
    ? { deviceToken: options.deviceToken, ...presentation }
    : { code: options.code, ...presentation }
  const helloNonce = nacl.randomBytes(nacl.box.nonceLength)
  const helloBox = nacl.box(utf8Encode(JSON.stringify(hello)), helloNonce, hostPub, keys.secretKey)
  transport.send(concat(keys.publicKey, helloNonce, helloBox))

  const first = await firstFrame(transport, options.handshakeTimeoutMs ?? 10_000)
  const plainError = plaintextError(first)
  if (plainError !== null) throw new TunnelError(plainError)
  if (typeof first === 'string') throw new TunnelError('handshake', 'unexpected text frame from host')
  const ackBytes = unseal(first, hostPub, keys.secretKey)
  if (ackBytes === null) throw new TunnelError('handshake', 'could not unseal host ack')
  const ack = JSON.parse(utf8Decode(ackBytes)) as { ok?: boolean; deviceToken?: string; hostName?: unknown; maxHttpBodyBytes?: unknown }
  // Code path: the ack must carry a freshly issued token; reconnect path: the presented bearer token persists.
  const deviceToken = typeof ack.deviceToken === 'string' ? ack.deviceToken : (options.deviceToken ?? null)
  if (ack.ok !== true || deviceToken === null) {
    throw new TunnelError('handshake', 'malformed ack')
  }
  if (typeof ack.deviceToken === 'string') await options.onDeviceToken?.(ack.deviceToken)
  if (typeof ack.hostName === 'string') {
    const displayName = ack.hostName.replace(/[\u0000-\u001f\u007f]/g, '').trim()
    if (displayName !== '') await options.onHostMetadata?.({ displayName: compactDisplayName(displayName, 'Host') })
  }
  return new TunnelSession(transport, hostPub, keys.secretKey, deviceToken, options, advertisedHttpBodyLimit(ack.maxHttpBodyBytes))
}

function advertisedHttpBodyLimit(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : DEFAULT_MAX_HTTP_BODY_BYTES
}

/** Session implementation; socket.ts and http.ts ride its demux maps. */
export class TunnelSession implements TunnelClient {
  readonly deviceToken: string | null
  readonly maxHttpBodyBytes: number
  private currentState: TunnelState = 'open'
  private sendSeq = 0
  private recvSeq = 0
  private idCounter = 0
  private readonly fetches = new Map<string, PendingFetch>()
  private readonly sockets = new Map<string, TunnelWebSocket>()
  private readonly probes = new Map<string, { resolve: () => void; reject: (error: TunnelError) => void; timer: ReturnType<typeof setTimeout> }>()

  private readonly transport: FrameTransport
  private readonly hostPub: Uint8Array
  private readonly ownSec: Uint8Array
  private readonly options: ConnectOptions

  constructor(
    transport: FrameTransport,
    hostPub: Uint8Array,
    ownSec: Uint8Array,
    deviceToken: string,
    options: ConnectOptions,
    maxHttpBodyBytes = DEFAULT_MAX_HTTP_BODY_BYTES,
  ) {
    this.transport = transport
    this.hostPub = hostPub
    this.ownSec = ownSec
    this.options = options
    this.deviceToken = deviceToken
    this.maxHttpBodyBytes = maxHttpBodyBytes
    // The transport owns ordered delivery (its normalization queue), so the
    // session handler is synchronous from here on.
    transport.onFrame((frame) => this.onFrame(frame))
    transport.onClose(() => this.teardown())
    options.onStateChange?.('open')
  }

  get state(): TunnelState {
    return this.currentState
  }

  mintId(): string {
    this.idCounter += 1
    return 'c' + this.idCounter
  }

  /** Seal and send one session message, assigning the next outgoing seq. */
  send(message: Record<string, unknown>): void {
    if (this.currentState !== 'open') throw new TunnelError('closed', 'tunnel is closed')
    const wire = message as WireMessage
    wire.seq = this.sendSeq
    this.sendSeq += 1
    const plain = utf8Encode(JSON.stringify(wire))
    if (plain.length > PLAINTEXT_LIMIT) throw new TunnelError('too-large', 'frame plaintext exceeds 200 KiB')
    const nonce = nacl.randomBytes(nacl.box.nonceLength)
    this.transport.send(concat(nonce, nacl.box(plain, nonce, this.hostPub, this.ownSec)))
  }

  fetch(path: string, init?: Parameters<TunnelClient['fetch']>[1]): Promise<Response> {
    if (this.currentState !== 'open') return Promise.reject(new TunnelError('closed', 'tunnel is closed'))
    return tunnelFetch(this, path, init)
  }

  openWebSocket(path: string): TunnelWebSocket {
    if (this.currentState !== 'open') throw new TunnelError('closed', 'tunnel is closed')
    return new TunnelWebSocket(this, path)
  }

  probe(timeoutMs = 10_000): Promise<void> {
    if (this.currentState !== 'open') return Promise.reject(new TunnelError('closed', 'tunnel is closed'))
    const id = this.mintId()
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.probes.delete(id)
        reject(new TunnelError('stale', 'heartbeat pong deadline exceeded'))
      }, timeoutMs)
      this.probes.set(id, { resolve, reject, timer })
      try {
        this.send({ t: 'ping', id })
      } catch (error) {
        clearTimeout(timer)
        this.probes.delete(id)
        reject(error instanceof TunnelError ? error : new TunnelError('closed', String(error)))
      }
    })
  }

  close(): void {
    try {
      this.transport.close(1000)
    } finally {
      this.teardown()
    }
  }

  discard(): void {
    this.teardown(false)
    try { this.transport.close(1000) } catch { /* already gone */ }
  }

  registerFetch(id: string, pending: PendingFetch): void {
    this.fetches.set(id, pending)
  }

  dropFetch(id: string): void {
    this.fetches.delete(id)
  }

  registerSocket(id: string, socket: TunnelWebSocket): void {
    this.sockets.set(id, socket)
  }

  dropSocket(id: string): void {
    this.sockets.delete(id)
  }

  private onFrame(frame: Uint8Array | string): void {
    if (typeof frame === 'string') return // no plaintext frames exist post-handshake
    const plain = unseal(frame, this.hostPub, this.ownSec)
    if (plain === null) return this.protocolClose('unseal failure')
    let message: WireMessage
    try {
      message = JSON.parse(utf8Decode(plain)) as WireMessage
    } catch {
      return this.protocolClose('malformed json')
    }
    if (typeof message.seq !== 'number' || message.seq !== this.recvSeq) {
      return this.protocolClose('seq violation')
    }
    this.recvSeq += 1
    this.dispatch(message)
  }

  private dispatch(message: WireMessage): void {
    const id = typeof message.id === 'string' ? message.id : undefined
    switch (message.t) {
      case 'http-res': {
        const pending = id === undefined ? undefined : this.fetches.get(id)
        pending?.onHead(message.status as number, message.headers as Record<string, string>, message.body as string | undefined, message.encoding as string | undefined)
        return
      }
      case 'http-data': {
        const pending = id === undefined ? undefined : this.fetches.get(id)
        pending?.onData(message.data as string, message.last === true)
        return
      }
      case 'ws-ack': return void (id !== undefined && this.sockets.get(id)?.onAck())
      case 'ws-err': return void (id !== undefined && this.sockets.get(id)?.onErr(String(message.message ?? 'refused')))
      case 'ws-msg': return void (id !== undefined && this.sockets.get(id)?.onMsg(message.data as string, message.binary === true))
      case 'ws-close': return void (id !== undefined && this.sockets.get(id)?.onHostClose(message.code as number | undefined, message.reason as string | undefined))
      case 'pong': {
        const probe = id === undefined ? undefined : this.probes.get(id)
        if (probe !== undefined && id !== undefined) {
          clearTimeout(probe.timer)
          this.probes.delete(id)
          probe.resolve()
        }
        return
      }
      default: return // unknown types are ignored, never fatal
    }
  }

  private protocolClose(reason: string): void {
    this.teardown()
    try {
      this.transport.close(1008, reason)
    } catch {
      // the transport is already gone; teardown above owns the state
    }
  }

  private teardown(notify = true): void {
    if (this.currentState === 'closed') return
    this.currentState = 'closed'
    const error = new TunnelError('closed', 'tunnel is closed')
    for (const pending of this.fetches.values()) pending.onAbort(error)
    this.fetches.clear()
    for (const socket of [...this.sockets.values()]) socket.tunnelClosed()
    this.sockets.clear()
    for (const probe of this.probes.values()) {
      clearTimeout(probe.timer)
      probe.reject(error)
    }
    this.probes.clear()
    if (notify) this.options.onStateChange?.('closed')
  }
}

function onceOpen(ws: WebSocket, timeoutMs = 10_000, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => finish(new TunnelError('timeout', 'endpoint WebSocket connection timed out')), timeoutMs)
    const finish = (error?: TunnelError): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      if (error === undefined) resolve()
      else reject(error)
    }
    const onAbort = (): void => {
      try { ws.close() } catch { /* already gone */ }
      finish(new TunnelError('closed', 'connection aborted'))
    }
    if (signal?.aborted) {
      onAbort()
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    ws.addEventListener('open', () => finish(), { once: true })
    ws.addEventListener('error', () => finish(new TunnelError('handshake', 'endpoint WebSocket connection failed')), { once: true })
    ws.addEventListener('close', () => finish(new TunnelError('handshake', 'endpoint WebSocket connection failed')), { once: true })
  })
}

function firstFrame(transport: FrameTransport, timeoutMs: number): Promise<Uint8Array | string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new TunnelError('timeout', 'host handshake timed out')), timeoutMs)
    // Single-slot handlers: the session constructor replaces both right after
    // the handshake resolves, so nothing accumulates.
    transport.onFrame((frame) => {
      clearTimeout(timer)
      resolve(frame)
    })
    transport.onClose(() => {
      clearTimeout(timer)
      reject(new TunnelError('handshake', 'transport closed during handshake'))
    })
  })
}

/** @returns the host's plaintext error code, or null when the frame is a sealed ack. */
function plaintextError(frame: Uint8Array | string): string | null {
  let text: string | null = null
  if (typeof frame === 'string') {
    text = frame
  } else if (frame.length > 0 && frame[0] === 0x7b) {
    text = utf8Decode(frame) // '{' — plaintext JSON error frame
  }
  if (text === null) return null
  try {
    const parsed = JSON.parse(text) as { error?: string }
    return typeof parsed.error === 'string' ? parsed.error : 'handshake'
  } catch {
    return 'handshake'
  }
}

function unseal(frame: Uint8Array, peerPub: Uint8Array, ownSec: Uint8Array): Uint8Array | null {
  if (frame.length < nacl.box.nonceLength + nacl.box.overheadLength) return null
  const nonce = frame.slice(0, nacl.box.nonceLength)
  return nacl.box.open(frame.slice(nacl.box.nonceLength), nonce, peerPub, ownSec)
}
