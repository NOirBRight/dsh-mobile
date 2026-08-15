/**
 * Host tunnel endpoint (docs/tunnel-protocol.md §3). Drives one relay socket:
 * the first frame must be a handshake (§2); afterwards every frame is a sealed
 * session message — nonce(24B) || box(json, peerPub, ownSec) — with a
 * per-direction seq from 0, strictly consecutive. A seq gap/duplicate closes
 * the connection (relay replay/injection defense).
 *
 * Demultiplexing: http-req issues a real request to the loopback dsh web
 * server (Host rewritten to the loopback authority, so the upstream /api
 * trust fence passes); ws-open builds a loopback WebSocket (e.g.
 * /api/events.mux) bridged both ways. Loopback WS needs no subprotocol —
 * direct connection (M1's subprotocol dance belongs to the LAN proxy, not
 * the tunnel).
 *
 * Ambiguity resolutions (recorded in README §M3 interpretations):
 *  - Mid-socket re-handshake: a roaming client re-joins the relay room while
 *    this host socket stays up, so a fresh handshake frame can arrive on a
 *    socket that already runs a session. A frame that fails box.open under
 *    the current peer key is retried as a handshake — a fresh ephemeral key
 *    can never authenticate under the old one, so the fallback is exact. A
 *    successful re-handshake replaces the session (old bridges/pending
 *    requests torn down, both seq domains reset).
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

const MAX_PLAINTEXT_BYTES = 200 * 1024
const MAX_BODY_BYTES = 8 * 1024 * 1024
/** Raw bytes per inline body / continuation chunk (~128 KiB base64, safely under the 200 KiB frame cap). */
const BODY_CHUNK_BYTES = 96 * 1024

const CLOSE_BAD_FRAME = 4400
const CLOSE_BAD_SEQ = 4401
const CLOSE_TOO_LARGE = 4413

const BODILESS_METHODS = new Set(['GET', 'HEAD', 'DELETE', 'OPTIONS'])
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

/** A live gate (pre-handshake) or session (post-handshake) on one relay socket. */
export interface RelaySocketGate {
  /** Close the socket and tear down every upstream bridge and pending request. */
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

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * Attach the host tunnel endpoint to a freshly connected relay socket.
 * @param socket - the relay socket (role=host), pre-handshake.
 * @param options - see {@link TunnelEndpointOptions}.
 * @returns a gate handle; close() is idempotent.
 */
export function attachRelaySocket(socket: WebSocket, options: TunnelEndpointOptions): RelaySocketGate {
  const ownSec = options.handshake.keypair.secretKeyRaw
  const authority = options.upstreamHost + ':' + options.upstreamPort
  const log = (msg: string): void => options.logger?.(msg)
  let session: SessionState | null = null
  let closed = false

  function newSession(peerPub: Uint8Array): SessionState {
    return { peerPub, inSeq: 0, outSeq: 0, requests: new Map(), bridges: new Map(), closedBridges: new Set() }
  }

  /** Seal and send one session message, stamping the outgoing seq. No-op once closed. */
  function sendMsg(owner: SessionState, msg: Record<string, unknown>): void {
    if (closed || session !== owner) return
    const plaintext = encoder.encode(JSON.stringify({ ...msg, seq: owner.outSeq++ }))
    const nonce = nacl.randomBytes(nacl.box.nonceLength)
    const boxed = nacl.box(plaintext, nonce, owner.peerPub, ownSec)
    const frame = new Uint8Array(nacl.box.nonceLength + boxed.length)
    frame.set(nonce, 0)
    frame.set(boxed, nacl.box.nonceLength)
    socket.send(frame)
  }

  /** Tear down every upstream resource of a session (re-handshake or socket close). */
  function teardownSession(target: SessionState): void {
    for (const bridge of target.bridges.values()) bridge.close()
    target.bridges.clear()
    target.requests.clear()
    target.closedBridges.clear()
  }

  function closeSocket(code: number, reason: string): void {
    socket.close(code, reason)
  }

  /** Replace the session after a successful (re-)handshake and send the ack. */
  function adoptSession(peerPub: Uint8Array, ackFrame: Uint8Array, resumed: boolean): void {
    if (session !== null) teardownSession(session)
    session = newSession(peerPub)
    socket.send(ackFrame)
    log(resumed ? 'tunnel session resumed via re-handshake' : 'tunnel session established')
  }

  // ── HTTP request path ────────────────────────────────────────────────────

  function onHttpReq(owner: SessionState, msg: { id?: unknown; method?: unknown; path?: unknown; headers?: unknown; body?: unknown }): void {
    if (typeof msg.id !== 'string' || typeof msg.method !== 'string' || typeof msg.path !== 'string') return closeSocket(CLOSE_BAD_FRAME, 'bad http-req')
    if (typeof msg.headers !== 'object' || msg.headers === null) return closeSocket(CLOSE_BAD_FRAME, 'bad http-req headers')
    if (owner.requests.has(msg.id)) return closeSocket(CLOSE_BAD_FRAME, 'duplicate http id')
    const pending: PendingHttp = {
      method: msg.method.toUpperCase(),
      path: msg.path,
      headers: msg.headers as Record<string, string | string[]>,
      chunks: [],
      size: 0,
    }
    owner.requests.set(msg.id, pending)
    if (typeof msg.body === 'string') {
      pending.chunks.push(Buffer.from(msg.body, 'base64'))
      pending.size = pending.chunks[0].length
    }
    const complete = typeof msg.body === 'string' || BODILESS_METHODS.has(pending.method)
    if (pending.size > MAX_BODY_BYTES) return refuseBody(owner, msg.id)
    if (complete) forwardRequest(owner, msg.id)
  }

  function onHttpData(owner: SessionState, msg: { id?: unknown; data?: unknown; last?: unknown }): void {
    if (typeof msg.id !== 'string' || typeof msg.data !== 'string') return closeSocket(CLOSE_BAD_FRAME, 'bad http-data')
    const pending = owner.requests.get(msg.id)
    if (pending === undefined) return closeSocket(CLOSE_BAD_FRAME, 'http-data for unknown id')
    const chunk = Buffer.from(msg.data, 'base64')
    pending.chunks.push(chunk)
    pending.size += chunk.length
    if (pending.size > MAX_BODY_BYTES) return refuseBody(owner, msg.id)
    if (msg.last === true) forwardRequest(owner, msg.id)
  }

  /** Answer 413 for an oversized request body and drop the pending state. */
  function refuseBody(owner: SessionState, id: string): void {
    owner.requests.delete(id)
    sendMsg(owner, { t: 'http-res', id, status: 413, headers: {}, body: '' })
  }

  function forwardRequest(owner: SessionState, id: string): void {
    const pending = owner.requests.get(id)
    if (pending === undefined) return
    owner.requests.delete(id)
    const headers: Record<string, string | string[]> = {}
    for (const [key, value] of Object.entries(pending.headers)) {
      if (STRIPPED_REQUEST_HEADERS.has(key.toLowerCase())) continue
      headers[key] = value
    }
    headers.host = authority
    const upstreamReq = request(
      { host: options.upstreamHost, port: options.upstreamPort, method: pending.method, path: pending.path, headers },
      (upstreamRes) => collectResponse(owner, id, upstreamRes),
    )
    upstreamReq.on('error', () => sendMsg(owner, { t: 'http-res', id, status: 502, headers: {}, body: '' }))
    upstreamReq.end(Buffer.concat(pending.chunks))
  }

  /** Buffer the upstream response (§4 cap) and frame it back. */
  function collectResponse(owner: SessionState, id: string, res: IncomingMessage): void {
    const chunks: Buffer[] = []
    let size = 0
    let overflow = false
    res.on('data', (chunk: Buffer) => {
      if (overflow) return
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        overflow = true
        res.destroy()
        sendMsg(owner, { t: 'http-res', id, status: 502, headers: {}, body: '' })
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
        sendMsg(owner, { t: 'http-res', id, status: res.statusCode ?? 502, headers, body: raw.toString('base64') })
        return
      }
      sendMsg(owner, { t: 'http-res', id, status: res.statusCode ?? 502, headers })
      for (let offset = 0; offset < raw.length; offset += BODY_CHUNK_BYTES) {
        const slice = raw.subarray(offset, offset + BODY_CHUNK_BYTES)
        sendMsg(owner, { t: 'http-data', id, data: slice.toString('base64'), last: offset + BODY_CHUNK_BYTES >= raw.length })
      }
    })
    res.on('error', () => {
      if (!overflow) sendMsg(owner, { t: 'http-res', id, status: 502, headers: {}, body: '' })
    })
  }

  // ── Loopback WebSocket bridge path ───────────────────────────────────────

  function onWsOpen(owner: SessionState, msg: { id?: unknown; path?: unknown }): void {
    if (typeof msg.id !== 'string' || typeof msg.path !== 'string' || !msg.path.startsWith('/')) {
      return closeSocket(CLOSE_BAD_FRAME, 'bad ws-open')
    }
    if (owner.bridges.has(msg.id) || owner.closedBridges.has(msg.id)) return closeSocket(CLOSE_BAD_FRAME, 'duplicate ws id')
    const id = msg.id
    const upstream = new WebSocket('ws://' + authority + msg.path)
    let opened = false
    owner.bridges.set(id, upstream)
    upstream.on('open', () => {
      opened = true
      sendMsg(owner, { t: 'ws-ack', id })
    })
    upstream.on('message', (data: Buffer) => {
      sendMsg(owner, { t: 'ws-msg', id, data: data.toString('base64') })
    })
    upstream.on('error', (error: Error) => {
      if (!opened) {
        owner.bridges.delete(id)
        owner.closedBridges.add(id)
        sendMsg(owner, { t: 'ws-err', id, message: error.message })
      }
      // After a successful open an error is always followed by close, which reports it.
    })
    upstream.on('close', (code: number, reason: Buffer) => {
      owner.bridges.delete(id)
      owner.closedBridges.add(id)
      sendMsg(owner, { t: 'ws-close', id, code, reason: reason.toString() })
    })
  }

  function onWsMsg(owner: SessionState, msg: { id?: unknown; data?: unknown }): void {
    if (typeof msg.id !== 'string' || typeof msg.data !== 'string') return closeSocket(CLOSE_BAD_FRAME, 'bad ws-msg')
    const bridge = owner.bridges.get(msg.id)
    if (bridge !== undefined) {
      if (bridge.readyState === WebSocket.OPEN) bridge.send(Buffer.from(msg.data, 'base64'))
      return
    }
    if (owner.closedBridges.has(msg.id)) return // late frame for a closed bridge: normal race
    closeSocket(CLOSE_BAD_FRAME, 'ws-msg for unknown id')
  }

  function onWsClose(owner: SessionState, msg: { id?: unknown; code?: unknown; reason?: unknown }): void {
    if (typeof msg.id !== 'string') return closeSocket(CLOSE_BAD_FRAME, 'bad ws-close')
    const bridge = owner.bridges.get(msg.id)
    if (bridge !== undefined) {
      owner.bridges.delete(msg.id)
      owner.closedBridges.add(msg.id)
      bridge.close(typeof msg.code === 'number' ? msg.code : 1000, typeof msg.reason === 'string' ? msg.reason : undefined)
      return
    }
    if (owner.closedBridges.has(msg.id)) return // late close
    closeSocket(CLOSE_BAD_FRAME, 'ws-close for unknown id')
  }

  // ── Frame entry ──────────────────────────────────────────────────────────

  socket.on('message', (data: Buffer, isBinary: boolean) => {
    if (closed) return
    if (!isBinary) return closeSocket(CLOSE_BAD_FRAME, 'text frame')
    const frame = new Uint8Array(data)

    if (session === null) {
      const outcome = hostHandshake(frame, options.handshake)
      if (!outcome.ok) {
        // Reject in place: the host stays seated (closing here would drop the
        // room and let one bad hello DoS the host); the rejected client owns
        // closing its own connection and releasing the client seat.
        socket.send(outcome.errorFrame)
        return
      }
      adoptSession(outcome.peerPub, outcome.ackFrame, false)
      return
    }

    if (frame.length < nacl.box.nonceLength + nacl.box.overheadLength) return closeSocket(CLOSE_BAD_FRAME, 'short frame')
    const nonce = frame.subarray(0, nacl.box.nonceLength)
    const opened = nacl.box.open(frame.subarray(nacl.box.nonceLength), nonce, session.peerPub, ownSec)
    if (opened === null) {
      // Not a session frame under the current key: a roaming client re-joined
      // the room and re-handshook on this same socket (see header comment).
      const outcome = hostHandshake(frame, options.handshake)
      if (!outcome.ok) {
        socket.send(outcome.errorFrame) // stay seated, as above
        return
      }
      adoptSession(outcome.peerPub, outcome.ackFrame, true)
      return
    }
    if (opened.length > MAX_PLAINTEXT_BYTES) return closeSocket(CLOSE_TOO_LARGE, 'frame too large')

    const owner = session
    let msg: { t?: unknown; seq?: unknown; id?: unknown }
    try {
      msg = JSON.parse(decoder.decode(opened)) as { t?: unknown; seq?: unknown; id?: unknown }
    } catch {
      return closeSocket(CLOSE_BAD_FRAME, 'bad json')
    }
    if (msg.seq !== owner.inSeq) return closeSocket(CLOSE_BAD_SEQ, 'seq violation')
    owner.inSeq++

    switch (msg.t) {
      case 'http-req': return onHttpReq(owner, msg)
      case 'http-data': return onHttpData(owner, msg)
      case 'ws-open': return onWsOpen(owner, msg)
      case 'ws-msg': return onWsMsg(owner, msg)
      case 'ws-close': return onWsClose(owner, msg)
      default: return closeSocket(CLOSE_BAD_FRAME, 'unknown type ' + String(msg.t))
    }
  })

  socket.on('close', () => {
    closed = true
    if (session !== null) {
      teardownSession(session)
      session = null
    }
    options.onSessionClose?.()
  })
  socket.on('error', () => {}) // close follows; teardown lives there

  return {
    close() {
      if (closed) return
      closed = true
      if (session !== null) {
        teardownSession(session)
        session = null
      }
      socket.close()
    },
  }
}
