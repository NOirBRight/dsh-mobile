/**
 * LAN auth reverse proxy: the single LAN-side door in front of the loopback
 * dsh web server. HTTP authenticates via `Authorization: Bearer`, WebSocket
 * upgrades authenticate via a Sec-WebSocket-Protocol entry (never a query
 * param — URLs land in logs, subprotocols do not). Forwarded requests get
 * their Host rewritten to the loopback authority, so the upstream /api
 * browser-trust fence classifies them as loopback and passes. Unauthenticated
 * requests get 401 (HTTP) or a rejected handshake (WS); only /healthz is
 * exempt, mirroring Paseo's /api/health exemption.
 */
import { createServer, request } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { connect } from 'node:net'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'

/** The Sec-WebSocket-Protocol entry carrying the device token: `dsh-mobile.<token>`. */
export const WS_AUTH_PREFIX = 'dsh-mobile.'

/** What the proxy needs from the device token store. */
export interface TokenAuthenticator {
  /** @param token - plaintext token. @returns truthy for a live token, null otherwise. */
  authenticate(token: string): unknown | null
}

/** Proxy construction options. */
export interface AuthProxyOptions {
  /** Bind host (LAN side). */
  bind: string
  /** Bind port; 0 asks the OS. */
  port: number
  /** Upstream host — loopback in every supported deployment. */
  upstreamHost: string
  /** Upstream dsh web port. */
  upstreamPort: number
  /** Device token verifier. */
  tokenStore: TokenAuthenticator
}

/** A running (or startable) auth proxy. */
export interface AuthProxy {
  /** @returns the listened port, or null until {@link listen} resolves. */
  port(): number | null
  /** @returns the listened port once bound. */
  listen(): Promise<number>
  /** Stop listening and destroy every tracked connection. */
  close(): Promise<void>
}

/**
 * Create the proxy. Nothing binds until {@link AuthProxy.listen}.
 * @param options - see {@link AuthProxyOptions}.
 * @returns the proxy handle.
 */
export function createAuthProxy(options: AuthProxyOptions): AuthProxy {
  const { upstreamHost, upstreamPort, tokenStore } = options
  const upstreamAuthority = `${upstreamHost}:${upstreamPort}`
  let listenedPort: number | null = null
  const upgradedSockets = new Set<Duplex>()

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    handleHttp(req, res).catch(() => {
      // A handler failure answers 400 (or destroys a started response); it
      // never takes the process down — same posture as the upstream webserver.
      if (res.headersSent) {
        res.destroy()
        return
      }
      res.writeHead(400)
      res.end()
    })
  })

  async function handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://x')
    if (req.method === 'GET' && url.pathname === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('ok')
      return
    }
    const header = req.headers.authorization
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null
    if (token === null || tokenStore.authenticate(token) === null) {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'unauthorized' }))
      return
    }
    const headers: Record<string, string | string[]> = {}
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined) continue
      // Hop-by-hop and credential headers do not cross the proxy.
      if (key === 'connection' || key === 'keep-alive' || key === 'proxy-authorization' || key === 'authorization') continue
      headers[key] = value
    }
    headers.host = upstreamAuthority
    const upstreamReq = request(
      { host: upstreamHost, port: upstreamPort, method: req.method, path: req.url, headers },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers)
        upstreamRes.pipe(res)
      },
    )
    upstreamReq.on('error', () => {
      if (!res.headersSent) res.writeHead(502)
      res.end()
    })
    req.pipe(upstreamReq)
  }

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on('error', () => {}) // teardown flows through close; nothing else can reach here
    upgradedSockets.add(socket)
    socket.once('close', () => upgradedSockets.delete(socket))

    const offered = String(req.headers['sec-websocket-protocol'] ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
    const authEntry = offered.find((entry) => entry.startsWith(WS_AUTH_PREFIX))
    const token = authEntry === undefined ? null : authEntry.slice(WS_AUTH_PREFIX.length)
    if (token === null || tokenStore.authenticate(token) === null) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nconnection: close\r\n\r\n')
      socket.destroy()
      return
    }

    const upstream = connect(upstreamPort, upstreamHost)
    upgradedSockets.add(upstream)
    upstream.once('close', () => {
      upgradedSockets.delete(upstream)
      socket.destroy()
    })
    socket.once('close', () => upstream.destroy())
    upstream.on('error', () => socket.destroy())

    // Rebuild the handshake against the upstream: Host rewritten to loopback,
    // the auth subprotocol entry consumed by the proxy (not forwarded).
    upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n`)
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined) continue
      if (key === 'host') {
        upstream.write(`host: ${upstreamAuthority}\r\n`)
        continue
      }
      if (key === 'sec-websocket-protocol') {
        const kept = offered.filter((entry) => !entry.startsWith(WS_AUTH_PREFIX))
        if (kept.length > 0) upstream.write(`sec-websocket-protocol: ${kept.join(', ')}\r\n`)
        continue
      }
      upstream.write(`${key}: ${Array.isArray(value) ? value.join(', ') : value}\r\n`)
    }
    upstream.write('\r\n')
    if (head.length > 0) upstream.write(head)

    // Forward the upstream handshake response verbatim, then pipe raw both ways.
    const chunks: Buffer[] = []
    const onData = (chunk: Buffer): void => {
      chunks.push(chunk)
      const joined = Buffer.concat(chunks)
      const end = joined.indexOf('\r\n\r\n')
      if (end === -1) {
        if (joined.length > 16 * 1024) {
          socket.destroy()
          upstream.destroy()
        }
        return
      }
      upstream.off('data', onData)
      // The upstream never speaks subprotocols, but strict WS clients (the ws
      // library among them) abort when their offered protocols go unselected.
      // The proxy therefore selects the auth entry back to the client; the
      // entry itself never crossed to the upstream.
      let headerBlock = joined.subarray(0, end + 4).toString()
      if (headerBlock.startsWith('HTTP/1.1 101') && !headerBlock.toLowerCase().includes('sec-websocket-protocol:')) {
        headerBlock = headerBlock.replace('\r\n\r\n', `\r\nsec-websocket-protocol: ${authEntry}\r\n\r\n`)
      }
      socket.write(headerBlock)
      socket.write(joined.subarray(end + 4))
      socket.pipe(upstream)
      upstream.pipe(socket)
    }
    upstream.on('data', onData)
  })

  return {
    port: () => listenedPort,
    listen: () =>
      new Promise<number>((resolve, reject) => {
        server.once('error', reject)
        server.listen(options.port, options.bind, () => {
          server.off('error', reject)
          listenedPort = (server.address() as AddressInfo).port
          resolve(listenedPort)
        })
      }),
    close: () =>
      new Promise<void>((resolve) => {
        const serverClosed = new Promise<void>((done) => {
          server.close(() => done())
        })
        server.closeAllConnections()
        for (const socket of upgradedSockets) socket.destroy()
        void serverClosed.then(() => resolve())
      }),
  }
}
