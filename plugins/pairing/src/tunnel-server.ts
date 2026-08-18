/**
 * Host tunnel endpoint (docs/tunnel-protocol.md §3), built on a
 * transport-neutral frame carrier (host-transport.ts). The session mux below
 * knows nothing about WebSockets or DataChannels: it sees a
 * HostFrameTransport plus an authenticated peer key. Every session frame is a
 * sealed message — nonce(24B) || box(json, peerPub, ownSec) — with a
 * per-direction seq from 0, strictly consecutive. A seq gap/duplicate closes
 * the connection (relay replay/injection defense).
 *
 * Two attach paths:
 *  - attachRelaySocket: the M3 relay path. Wraps the relay socket in a
 *    WsRelayTransport and gates it with the §2 handshake — the first frame
 *    must be a hello; afterwards the socket runs a session.
 *  - attachHandshakeTransport: the product path. WebRTC DataChannel and
 *    Gateway tunnel sockets both run the sealed hello/ack, then the session.
 *
 * Demultiplexing: http-req issues a real request to the loopback dsh web
 * server (Host rewritten to the loopback authority, so the upstream /api
 * trust fence passes); ws-open builds a loopback WebSocket (e.g.
 * /api/events.mux) bridged both ways. Loopback WS needs no subprotocol —
 * direct connection (M1's subprotocol dance belongs to the LAN proxy, not
 * the tunnel).
 *
 * Ambiguity resolutions (recorded in README §M3 interpretations):
 *  - Mid-socket re-handshake (relay path only): a roaming client re-joins
 *    the relay room while this host socket stays up, so a fresh handshake
 *    frame can arrive on a socket that already runs a session. A frame that
 *    fails box.open under the current peer key is retried as a handshake — a
 *    fresh ephemeral key can never authenticate under the old one, so the
 *    fallback is exact. A successful re-handshake replaces the session (old
 *    bridges/pending requests torn down, both seq domains reset).
 *  - Request-body completion: http-req with a body field (even empty) is
 *    complete; a bodyless method (GET/HEAD/DELETE/OPTIONS) without body is
 *    complete; any other method without body waits for http-data frames up to
 *    last:true. Responses mirror the rule: body inline when it fits one
 *    frame, else http-res without body followed by http-data chunks.
 *  - ws-msg to the loopback is always sent as a binary frame (the protocol
 *    carries no type flag; /api/events.* downlinks never read client data).
 *  - Late ws-msg/ws-close naming an already-closed bridge id are dropped
 *    (normal close race); any other unknown id closes with 4400.
 *  - Close codes (the protocol mandates closing, not codes): 4400 malformed
 *    frame/unknown id/text frame, 4401 seq violation, 4413 plaintext over
 *    200 KiB. Body limits (§4): request over 8 MiB → http-res 413; upstream
 *    response over 8 MiB → http-res 502.
 */
import { request } from 'node:http'
import type { IncomingMessage } from 'node:http'
import WebSocket from 'ws'
import nacl from 'tweetnacl'
import { hostHandshake } from './handshake.ts'
import type { HandshakeDeps } from './handshake.ts'
import { WsRelayTransport } from './host-transport.ts'
import type { HostFrameTransport } from './host-transport.ts'

const MAX_PLAINTEXT_BYTES = 200 * 1024
const MAX_BODY_BYTES = 8 * 1024 * 1024
/** Raw bytes per inline body / continuation chunk (~128 KiB base64, safely under the 200 KiB frame cap). */
const BODY_CHUNK_BYTES = 96 * 1024

const CLOSE_BAD_FRAME = 4400
const CLOSE_BAD_SEQ = 4401
const CLOSE_TOO_LARGE = 4413

const BODILESS_METHODS = new Set(['GET', 'HEAD', 'DELETE', 'OPTIONS'])

/** Origin-relative loopback target: pathname + search, never another host or the Host admin surface. */
function parseLoopbackTarget(path: string): { path: string; pathname: string } | null {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || /[\0\r\n]/.test(path)) return null
  try {
    const parsed = new URL(path, 'http://127.0.0.1')
    if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || parsed.port !== '' || parsed.username !== '' || parsed.password !== '') {
      return null
    }
    return { path: parsed.pathname + parsed.search, pathname: parsed.pathname }
  } catch {
    return null
  }
}

function isHostAdministrationPath(pathname: string): boolean {
  return pathname === '/pair' || pathname.startsWith('/pair/')
}
/** Hop-by-hop and credential headers never cross onto the loopback request. */
const STRIPPED_REQUEST_HEADERS = new Set([
  'host', 'connection', 'keep-alive', 'transfer-encoding', 'content-length',
  'authorization', 'proxy-authorization', 'upgrade',
  'sec-websocket-key', 'sec-websocket-version', 'sec-websocket-protocol', 'sec-websocket-extensions',
])
const STRIPPED_RESPONSE_HEADERS = new Set(['connection', 'keep-alive', 'transfer-encoding'])

/** Everything attachRelaySocket needs beyond the socket itself. */
export interface TunnelEndpointOptions {
  /** Upstream dsh web host — loopback in every supported deployment. */
  upstreamHost: string
  /** Upstream dsh web port. */
  upstreamPort: number
  /** Handshake inputs (keypair, offers, resume tokens). */
  handshake: HandshakeDeps
  /** Optional status logger. */
  logger?: (msg: string) => void
  /** Called once when the socket (and its session) has fully closed. */
  onSessionClose?: () => void
}

/** Everything attachAuthenticatedTransport needs beyond the carrier and peer key. */
export interface AuthenticatedTunnelOptions {
  /** Upstream dsh web host — loopback in every supported deployment. */
  upstreamHost: string
  /** Upstream dsh web port. */
  upstreamPort: number
  /** Host X25519 secret key (keypair.secretKeyRaw) that seals/opens session frames. */
  hostSecretKey: Uint8Array
  /** Optional status logger. */
  logger?: (msg: string) => void
  /** Called once when the transport (and its session) has fully closed. */
  onSessionClose?: () => void
}

/** A live gate (pre-handshake) or session (post-handshake) on one carrier. */
export interface RelaySocketGate {
  /** Close the carrier and tear down every upstream bridge and pending request. */
  close(): void
}

interface PendingHttp {
  method: string
  path: string
  headers: Record<string, string | string[]>
  chunks: Buffer[]
  size: number
}

interface SessionState {
  peerPub: Uint8Array
  inSeq: number
  outSeq: number
  requests: Map<string, PendingHttp>
  bridges: Map<string, WebSocket>
  closedBridges: Set<string>
}

/** One live session on a carrier: frame dispatch plus teardown of its upstream resources. */
interface HostTunnelSession {
  readonly peerPub: Uint8Array
  /**
   * Process one binary session frame. Returns false only when the frame does
   * not unseal under this session's peer key — the relay gate retries such a
   * frame as a handshake; every other violation closes the transport here.
   */
  handleFrame(frame: Uint8Array): boolean
  /** Idempotent: drop upstream bridges/pending requests and mute every pending send. */
  teardown(): void
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * Start the transport-neutral session mux (docs/tunnel-protocol.md §3) on an
 * already-authenticated carrier. Sealing, seq enforcement, HTTP demux, and
 * loopback WS bridging all live here; the carrier only moves opaque frames.
 */
function startHostSession(
  transport: HostFrameTransport,
  peerPub: Uint8Array,
  options: { upstreamHost: string; upstreamPort: number; ownSec: Uint8Array },
): HostTunnelSession {
  const { ownSec } = options
  const authority = options.upstreamHost + ':' + options.upstreamPort
  const state: SessionState = {
    peerPub: new Uint8Array(peerPub),
    inSeq: 0,
    outSeq: 0,
    requests: new Map(),
    bridges: new Map(),
    closedBridges: new Set(),
  }
  /** False once torn down (re-handshake or carrier close): mutes late upstream callbacks. */
  let active = true

  /** Seal and send one session message, stamping the outgoing seq. No-op once torn down. */
  function sendMsg(msg: Record<string, unknown>): void {
    if (!active) return
    const plaintext = encoder.encode(JSON.stringify({ ...msg, seq: state.outSeq++ }))
    const nonce = nacl.randomBytes(nacl.box.nonceLength)
    const boxed = nacl.box(plaintext, nonce, state.peerPub, ownSec)
    const frame = new Uint8Array(nacl.box.nonceLength + boxed.length)
    frame.set(nonce, 0)
    frame.set(boxed, nacl.box.nonceLength)
    transport.send(frame)
  }

  function closeTransport(code: number, reason: string): void {
    transport.close(code, reason)
  }

  // ── HTTP request path ────────────────────────────────────────────────────

  function onHttpReq(msg: { id?: unknown; method?: unknown; path?: unknown; headers?: unknown; body?: unknown }): void {
    if (typeof msg.id !== 'string' || typeof msg.method !== 'string' || typeof msg.path !== 'string') return closeTransport(CLOSE_BAD_FRAME, 'bad http-req')
    if (typeof msg.headers !== 'object' || msg.headers === null) return closeTransport(CLOSE_BAD_FRAME, 'bad http-req headers')
    const target = parseLoopbackTarget(msg.path)
    if (target === null) return closeTransport(CLOSE_BAD_FRAME, 'bad http-req path')
    if (isHostAdministrationPath(target.pathname)) {
      if (state.requests.has(msg.id)) return closeTransport(CLOSE_BAD_FRAME, 'duplicate http id')
      sendMsg({ t: 'http-res', id: msg.id, status: 404, headers: {}, body: '' })
      return
    }
    if (state.requests.has(msg.id)) return closeTransport(CLOSE_BAD_FRAME, 'duplicate http id')
    const pending: PendingHttp = {
      method: msg.method.toUpperCase(),
      path: target.path,
      headers: msg.headers as Record<string, string | string[]>,
      chunks: [],
      size: 0,
    }
    state.requests.set(msg.id, pending)
    if (typeof msg.body === 'string') {
      pending.chunks.push(Buffer.from(msg.body, 'base64'))
      pending.size = pending.chunks[0].length
    }
    const complete = typeof msg.body === 'string' || BODILESS_METHODS.has(pending.method)
    if (pending.size > MAX_BODY_BYTES) return refuseBody(msg.id)
    if (complete) forwardRequest(msg.id)
  }

  function onHttpData(msg: { id?: unknown; data?: unknown; last?: unknown }): void {
    if (typeof msg.id !== 'string' || typeof msg.data !== 'string') return closeTransport(CLOSE_BAD_FRAME, 'bad http-data')
    const pending = state.requests.get(msg.id)
    if (pending === undefined) return closeTransport(CLOSE_BAD_FRAME, 'http-data for unknown id')
    const chunk = Buffer.from(msg.data, 'base64')
    pending.chunks.push(chunk)
    pending.size += chunk.length
    if (pending.size > MAX_BODY_BYTES) return refuseBody(msg.id)
    if (msg.last === true) forwardRequest(msg.id)
  }

  /** Answer 413 for an oversized request body and drop the pending state. */
  function refuseBody(id: string): void {
    state.requests.delete(id)
    sendMsg({ t: 'http-res', id, status: 413, headers: {}, body: '' })
  }

  function forwardRequest(id: string): void {
    const pending = state.requests.get(id)
    if (pending === undefined) return
    state.requests.delete(id)
    const headers: Record<string, string | string[]> = {}
    for (const [key, value] of Object.entries(pending.headers)) {
      if (STRIPPED_REQUEST_HEADERS.has(key.toLowerCase())) continue
      headers[key] = value
    }
    headers.host = authority
    const upstreamReq = request(
      { host: options.upstreamHost, port: options.upstreamPort, method: pending.method, path: pending.path, headers, timeout: 60_000, agent: false },
      (upstreamRes) => collectResponse(id, upstreamRes),
    )
    upstreamReq.on('error', (error) => sendMsg({ t: 'http-res', id, status: 502, headers: { 'content-type': 'text/plain' }, body: Buffer.from(error.message).toString('base64') }))
    upstreamReq.on('timeout', () => upstreamReq.destroy(new Error('upstream timeout')))
    upstreamReq.end(Buffer.concat(pending.chunks))
  }

  /** Buffer the upstream response (§4 cap) and frame it back. */
  function collectResponse(id: string, res: IncomingMessage): void {
    const chunks: Buffer[] = []
    let size = 0
    let overflow = false
    res.on('data', (chunk: Buffer) => {
      if (overflow) return
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        overflow = true
        res.destroy()
        sendMsg({ t: 'http-res', id, status: 502, headers: {}, body: '' })
        return
      }
      chunks.push(chunk)
    })
    res.on('end', () => {
      if (overflow) return
      const headers: Record<string, string | string[]> = {}
      for (const [key, value] of Object.entries(res.headers)) {
        if (value === undefined || STRIPPED_RESPONSE_HEADERS.has(key)) continue
        headers[key] = value
      }
      const raw = Buffer.concat(chunks)
      if (raw.length <= BODY_CHUNK_BYTES) {
        sendMsg({ t: 'http-res', id, status: res.statusCode ?? 502, headers, body: raw.toString('base64') })
        return
      }
      sendMsg({ t: 'http-res', id, status: res.statusCode ?? 502, headers })
      for (let offset = 0; offset < raw.length; offset += BODY_CHUNK_BYTES) {
        const slice = raw.subarray(offset, offset + BODY_CHUNK_BYTES)
        sendMsg({ t: 'http-data', id, data: slice.toString('base64'), last: offset + BODY_CHUNK_BYTES >= raw.length })
      }
    })
    res.on('error', () => {
      if (!overflow) sendMsg({ t: 'http-res', id, status: 502, headers: {}, body: '' })
    })
  }

  // ── Loopback WebSocket bridge path ───────────────────────────────────────

  function onWsOpen(msg: { id?: unknown; path?: unknown }): void {
    if (typeof msg.id !== 'string' || typeof msg.path !== 'string') return closeTransport(CLOSE_BAD_FRAME, 'bad ws-open')
    const target = parseLoopbackTarget(msg.path)
    if (target === null) return closeTransport(CLOSE_BAD_FRAME, 'bad ws-open')
    if (state.bridges.has(msg.id) || state.closedBridges.has(msg.id)) return closeTransport(CLOSE_BAD_FRAME, 'duplicate ws id')
    const id = msg.id
    if (isHostAdministrationPath(target.pathname)) {
      state.closedBridges.add(id)
      sendMsg({ t: 'ws-err', id, message: 'not found' })
      return
    }
    const upstream = new WebSocket('ws://' + authority + target.path)
    let opened = false
    state.bridges.set(id, upstream)
    upstream.on('open', () => {
      opened = true
      sendMsg({ t: 'ws-ack', id })
    })
    upstream.on('message', (data: Buffer) => {
      sendMsg({ t: 'ws-msg', id, data: data.toString('base64') })
    })
    upstream.on('error', (error: Error) => {
      if (!opened) {
        state.bridges.delete(id)
        state.closedBridges.add(id)
        sendMsg({ t: 'ws-err', id, message: error.message })
      }
      // After a successful open an error is always followed by close, which reports it.
    })
    upstream.on('close', (code: number, reason: Buffer) => {
      state.bridges.delete(id)
      state.closedBridges.add(id)
      sendMsg({ t: 'ws-close', id, code, reason: reason.toString() })
    })
  }

  function onWsMsg(msg: { id?: unknown; data?: unknown }): void {
    if (typeof msg.id !== 'string' || typeof msg.data !== 'string') return closeTransport(CLOSE_BAD_FRAME, 'bad ws-msg')
    const bridge = state.bridges.get(msg.id)
    if (bridge !== undefined) {
      if (bridge.readyState === WebSocket.OPEN) bridge.send(Buffer.from(msg.data, 'base64'))
      return
    }
    if (state.closedBridges.has(msg.id)) return // late frame for a closed bridge: normal race
    closeTransport(CLOSE_BAD_FRAME, 'ws-msg for unknown id')
  }

  function onWsClose(msg: { id?: unknown; code?: unknown; reason?: unknown }): void {
    if (typeof msg.id !== 'string') return closeTransport(CLOSE_BAD_FRAME, 'bad ws-close')
    const bridge = state.bridges.get(msg.id)
    if (bridge !== undefined) {
      state.bridges.delete(msg.id)
      state.closedBridges.add(msg.id)
      bridge.close(typeof msg.code === 'number' ? msg.code : 1000, typeof msg.reason === 'string' ? msg.reason : undefined)
      return
    }
    if (state.closedBridges.has(msg.id)) return // late close
    closeTransport(CLOSE_BAD_FRAME, 'ws-close for unknown id')
  }

  // ── Frame entry ──────────────────────────────────────────────────────────

  return {
    peerPub: state.peerPub,

    handleFrame(frame: Uint8Array): boolean {
      if (frame.length < nacl.box.nonceLength + nacl.box.overheadLength) {
        closeTransport(CLOSE_BAD_FRAME, 'short frame')
        return true
      }
      const nonce = frame.subarray(0, nacl.box.nonceLength)
      const opened = nacl.box.open(frame.subarray(nacl.box.nonceLength), nonce, state.peerPub, ownSec)
      if (opened === null) return false // not sealed under this session's key; the caller decides (relay: retry as handshake)
      if (opened.length > MAX_PLAINTEXT_BYTES) return closeTransport(CLOSE_TOO_LARGE, 'frame too large'), true

      let msg: { t?: unknown; seq?: unknown; id?: unknown }
      try {
        msg = JSON.parse(decoder.decode(opened)) as { t?: unknown; seq?: unknown; id?: unknown }
      } catch {
        closeTransport(CLOSE_BAD_FRAME, 'bad json')
        return true
      }
      if (msg.seq !== state.inSeq) {
        closeTransport(CLOSE_BAD_SEQ, 'seq violation')
        return true
      }
      state.inSeq++

      switch (msg.t) {
        case 'ping':
          if (typeof msg.id !== 'string') return closeTransport(CLOSE_BAD_FRAME, 'bad ping'), true
          sendMsg({ t: 'pong', id: msg.id }); return true
        case 'http-req': onHttpReq(msg); return true
        case 'http-data': onHttpData(msg); return true
        case 'ws-open': onWsOpen(msg); return true
        case 'ws-msg': onWsMsg(msg); return true
        case 'ws-close': onWsClose(msg); return true
        default: closeTransport(CLOSE_BAD_FRAME, 'unknown type ' + String(msg.t)); return true
      }
    },

    teardown(): void {
      if (!active) return
      active = false
      for (const bridge of state.bridges.values()) bridge.close()
      state.bridges.clear()
      state.requests.clear()
      state.closedBridges.clear()
    },
  }
}

/**
 * Attach the host tunnel endpoint to an already-authenticated frame carrier
 * (e.g. a direct WebRTC DataChannel whose peer was verified out of band).
 * No hello handshake runs: the session starts immediately under peerPub.
 * @param transport - the carrier; see {@link HostFrameTransport}.
 * @param peerPub - the authenticated peer's X25519 public key (32 bytes).
 * @param options - see {@link AuthenticatedTunnelOptions}.
 * @returns a gate handle; close() is idempotent.
 */
export function attachAuthenticatedTransport(
  transport: HostFrameTransport,
  peerPub: Uint8Array,
  options: AuthenticatedTunnelOptions,
): RelaySocketGate {
  const log = (msg: string): void => options.logger?.(msg)
  let closed = false
  const session = startHostSession(transport, peerPub, {
    upstreamHost: options.upstreamHost,
    upstreamPort: options.upstreamPort,
    ownSec: options.hostSecretKey,
  })
  log('tunnel session established on authenticated transport')

  transport.onFrame((frame) => {
    if (closed) return
    if (typeof frame === 'string') return transport.close(CLOSE_BAD_FRAME, 'text frame')
    // No hello fallback on an authenticated carrier: the peer key was asserted
    // by the carrier, so an unsealable frame is corruption or an attack.
    if (!session.handleFrame(frame)) transport.close(CLOSE_BAD_FRAME, 'unsealable frame')
  })

  transport.onClose(() => {
    closed = true
    session.teardown()
    options.onSessionClose?.()
  })

  return {
    close() {
      if (closed) return
      closed = true
      session.teardown()
      transport.close()
    },
  }
}

/** Attach a pre-authentication carrier and run the NaCl hello/ack on it. */
export function attachHandshakeTransport(
  transport: HostFrameTransport,
  options: TunnelEndpointOptions,
): RelaySocketGate {
  const log = (msg: string): void => options.logger?.(msg)
  let session: HostTunnelSession | null = null
  let closed = false

  /** Replace the session after a successful (re-)handshake and send the ack. */
  function adoptSession(peerPub: Uint8Array, ackFrame: Uint8Array, resumed: boolean): void {
    session?.teardown()
    session = startHostSession(transport, peerPub, {
      upstreamHost: options.upstreamHost,
      upstreamPort: options.upstreamPort,
      ownSec: options.handshake.keypair.secretKeyRaw,
    })
    transport.send(ackFrame)
    log(resumed ? 'tunnel session resumed via re-handshake' : 'tunnel session established')
  }

  transport.onFrame((frame) => {
    if (closed) return
    if (typeof frame === 'string') return transport.close(CLOSE_BAD_FRAME, 'text frame')
    if (session !== null && session.handleFrame(frame)) return
    // Pre-handshake, or a frame that failed box.open under the current peer
    // key: a roaming client re-joined the room and re-handshook on this same
    // socket (see header comment).
    const resumed = session !== null
    const outcome = hostHandshake(frame, options.handshake)
    if (!outcome.ok) {
      // Reject in place: the host stays seated (closing here would drop the
      // room and let one bad hello DoS the host); the rejected client owns
      // closing its own connection and releasing the client seat.
      transport.send(outcome.errorFrame)
      return
    }
    adoptSession(outcome.peerPub, outcome.ackFrame, resumed)
  })

  transport.onClose(() => {
    closed = true
    session?.teardown()
    session = null
    options.onSessionClose?.()
  })

  return {
    close() {
      if (closed) return
      closed = true
      session?.teardown()
      session = null
      transport.close()
    },
  }
}

/** Preserve the relay entry point as a thin WebSocket adapter. */
export function attachRelaySocket(socket: WebSocket, options: TunnelEndpointOptions): RelaySocketGate {
  return attachHandshakeTransport(new WsRelayTransport(socket), options)
}
