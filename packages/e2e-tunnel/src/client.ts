import nacl from 'tweetnacl'
import { b64urlDecode, concat, utf8Decode, utf8Encode } from './bytes.ts'
import { TunnelError } from './errors.ts'
import { parseOffer, type Offer } from './offer.ts'
import { TunnelWebSocket } from './socket.ts'
import { tunnelFetch, type PendingFetch } from './http.ts'

/** Tunnel lifecycle, surfaced to the app badge. */
export type TunnelState = 'connecting' | 'open' | 'closed'

export interface ConnectOptions {
  /** Rotated single-use token from a previous session; takes precedence over the offer's one-time code. */
  /** Persistent device token from a previous pairing (permanent until revoked, protocol §5). */
  deviceToken?: string
  /** Called with the device token when one is issued (first pairing only — store it). */
  onDeviceToken?: (token: string) => void
  /** Called on every state transition. */
  onStateChange?: (state: TunnelState) => void
  /** Handshake wait bound; default 10_000 ms. */
  handshakeTimeoutMs?: number
  /** Transport-level reconnect attempts (roaming/4409 races); default 3. */
  connectRetries?: number
}

/** Live tunnel: multiplexed fetch + WebSocket over one sealed WSS room. */
export interface TunnelClient {
  /** Tunneled fetch; path is origin-relative (e.g. /api/host.describe). */
  fetch(path: string, init?: {
    method?: string
    headers?: HeadersInit
    body?: string | ArrayBuffer | Uint8Array | Blob | URLSearchParams | null
    signal?: AbortSignal | null
  }): Promise<Response>
  /** Open a tunneled WebSocket to a loopback path (e.g. /api/events.mux). */
  openWebSocket(path: string): TunnelWebSocket
  /** The device token this session runs on (permanent until revoked, protocol §5). */
  readonly deviceToken: string | null
  readonly state: TunnelState
  close(): void
}

interface WireMessage {
  t: string
  id?: string
  seq?: number
  [key: string]: unknown
}

const PLAINTEXT_LIMIT = 200 * 1024

/**
 * Pair and connect: parse the offer, join the relay room, run the sealed
 * handshake (tunnel-protocol.md section 2), and return the live session.
 * @param offerUrl QR content (URL with #offer= fragment or bare payload).
 * @param options resumeToken/callbacks/timeout.
 * @returns the open TunnelClient.
 * @throws TunnelError 'bad-offer' | 'expired' | 'bad-code' (host-rejected code/token) | 'handshake' | 'timeout'.
 */
export async function connect(offerUrl: string, options: ConnectOptions = {}): Promise<TunnelClient> {
  options.onStateChange?.('connecting')
  try {
    const offer = parseOffer(offerUrl)
    const hostPub = b64urlDecode(offer.pubkey)
    const maxAttempts = Math.max(1, options.connectRetries ?? 3)
    for (let attempt = 1; ; attempt++) {
      try {
        return await attemptConnect(offer, hostPub, options)
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

async function attemptConnect(offer: Offer, hostPub: Uint8Array, options: ConnectOptions): Promise<TunnelClient> {
  const keys = nacl.box.keyPair()
  const ws = new WebSocket(offer.addr + '/r/' + offer.room + '?role=client')
  ws.binaryType = 'arraybuffer'
  try {
    await onceOpen(ws)

    const hello = options.deviceToken ? { deviceToken: options.deviceToken } : { code: offer.code }
  const helloNonce = nacl.randomBytes(nacl.box.nonceLength)
  const helloBox = nacl.box(utf8Encode(JSON.stringify(hello)), helloNonce, hostPub, keys.secretKey)
  ws.send(concat(keys.publicKey, helloNonce, helloBox))

  const first = await firstFrame(ws, options.handshakeTimeoutMs ?? 10_000)
  const plainError = plaintextError(first)
  if (plainError !== null) throw new TunnelError(plainError)
  if (typeof first === 'string') throw new TunnelError('handshake', 'unexpected text frame from host')
  const ackBytes = unseal(first, hostPub, keys.secretKey)
  if (ackBytes === null) throw new TunnelError('handshake', 'could not unseal host ack')
  const ack = JSON.parse(utf8Decode(ackBytes)) as { ok?: boolean; deviceToken?: string }
    // Code path: the ack must carry a freshly issued token; reconnect path: the presented bearer token persists.
    const deviceToken = typeof ack.deviceToken === 'string' ? ack.deviceToken : (options.deviceToken ?? null)
    if (ack.ok !== true || deviceToken === null) {
      throw new TunnelError('handshake', 'malformed ack')
    }
    if (typeof ack.deviceToken === 'string') options.onDeviceToken?.(ack.deviceToken)
    return new TunnelSession(ws, hostPub, keys.secretKey, deviceToken, options)
  } catch (error) {
    // A rejected/failed attempt must release the room seat (one client per
    // room); the host stays seated and never closes on a bad hello.
    try { ws.close(1000) } catch { /* already gone */ }
    throw error
  }
}

/** Session implementation; socket.ts and http.ts ride its demux maps. */
export class TunnelSession implements TunnelClient {
  readonly deviceToken: string | null
  private currentState: TunnelState = 'open'
  private sendSeq = 0
  private recvSeq = 0
  private idCounter = 0
  private readonly fetches = new Map<string, PendingFetch>()
  private readonly sockets = new Map<string, TunnelWebSocket>()

  private readonly ws: WebSocket
  private readonly hostPub: Uint8Array
  private readonly ownSec: Uint8Array
  private readonly options: ConnectOptions

  constructor(
    ws: WebSocket,
    hostPub: Uint8Array,
    ownSec: Uint8Array,
    deviceToken: string,
    options: ConnectOptions,
  ) {
    this.ws = ws
    this.hostPub = hostPub
    this.ownSec = ownSec
    this.options = options
    this.deviceToken = deviceToken
    ws.addEventListener('message', (ev) => {
      // Blob payloads force async reads; the queue keeps seq-order regardless.
      this.frameQueue = this.frameQueue.then(() => this.onFrame(ev)).catch(() => {})
    })
    ws.addEventListener('close', () => this.teardown())
    ws.addEventListener('error', () => {}) // close always follows; teardown owns the bookkeeping
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
    this.ws.send(concat(nonce, nacl.box(plain, nonce, this.hostPub, this.ownSec)))
  }

  fetch(path: string, init?: Parameters<TunnelClient['fetch']>[1]): Promise<Response> {
    if (this.currentState !== 'open') return Promise.reject(new TunnelError('closed', 'tunnel is closed'))
    return tunnelFetch(this, path, init)
  }

  openWebSocket(path: string): TunnelWebSocket {
    if (this.currentState !== 'open') throw new TunnelError('closed', 'tunnel is closed')
    return new TunnelWebSocket(this, path)
  }

  close(): void {
    try {
      this.ws.close(1000)
    } finally {
      this.teardown()
    }
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

  private frameQueue: Promise<void> = Promise.resolve()

  private async onFrame(ev: MessageEvent): Promise<void> {
    const data = await frameData(ev).catch(() => null)
    if (data === null || typeof data === 'string') return // no plaintext frames exist post-handshake
    const plain = unseal(data, this.hostPub, this.ownSec)
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
        pending?.onHead(message.status as number, message.headers as Record<string, string>, message.body as string | undefined)
        return
      }
      case 'http-data': {
        const pending = id === undefined ? undefined : this.fetches.get(id)
        pending?.onData(message.data as string, message.last === true)
        return
      }
      case 'ws-ack': return void (id !== undefined && this.sockets.get(id)?.onAck())
      case 'ws-err': return void (id !== undefined && this.sockets.get(id)?.onErr(String(message.message ?? 'refused')))
      case 'ws-msg': return void (id !== undefined && this.sockets.get(id)?.onMsg(message.data as string))
      case 'ws-close': return void (id !== undefined && this.sockets.get(id)?.onHostClose(message.code as number | undefined, message.reason as string | undefined))
      default: return // unknown types are ignored, never fatal
    }
  }

  private protocolClose(reason: string): void {
    this.teardown()
    try {
      this.ws.close(1008, reason)
    } catch {
      // the socket is already gone; teardown above owns the state
    }
  }

  private teardown(): void {
    if (this.currentState === 'closed') return
    this.currentState = 'closed'
    const error = new TunnelError('closed', 'tunnel is closed')
    for (const pending of this.fetches.values()) pending.onAbort(error)
    this.fetches.clear()
    for (const socket of [...this.sockets.values()]) socket.tunnelClosed()
    this.sockets.clear()
    this.options.onStateChange?.('closed')
  }
}

function onceOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true })
    ws.addEventListener('error', () => reject(new TunnelError('handshake', 'relay connection failed')), { once: true })
  })
}

/**
 * Normalize a WS message payload to bytes or text. binaryType='arraybuffer'
 * is a HINT some WebViews (WeChat/TBS among them) ignore and deliver Blobs
 * anyway; slicing those as ArrayBuffer ends in tweetnacl size errors.
 */
async function frameData(ev: MessageEvent): Promise<Uint8Array | string> {
  const data = ev.data as unknown
  if (typeof data === 'string') return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (typeof Blob !== 'undefined' && data instanceof Blob) return new Uint8Array(await data.arrayBuffer())
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  throw new TunnelError('handshake', 'unsupported frame payload type')
}

function firstFrame(ws: WebSocket, timeoutMs: number): Promise<Uint8Array | string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new TunnelError('timeout', 'host handshake timed out')), timeoutMs)
    ws.addEventListener('message', (ev) => {
      clearTimeout(timer)
      void frameData(ev).then(resolve, reject)
    }, { once: true })
    ws.addEventListener('close', () => {
      clearTimeout(timer)
      reject(new TunnelError('handshake', 'relay closed during handshake'))
    }, { once: true })
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
