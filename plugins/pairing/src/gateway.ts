/** Standalone loopback Host Gateway: bounded protocol HTTP and WebSocket entry. */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { WebSocketServer, type WebSocket } from 'ws'
import type { PublicEndpointCapabilities } from './pairing.ts'

export interface GatewayEndpoint { url: string; kind: 'temporary' | 'custom' }
export interface GatewayAsset { body: Uint8Array; contentType: string; cacheControl?: string }
export interface HostGatewayOptions {
  bind: '127.0.0.1' | '::1' | 'localhost'
  port: number
  hostIdentity: string
  /** Optional static files. HTML product shells are never served; the APK is the only client. */
  shellAsset?(path: string): GatewayAsset | null
  /** Host-side authorization lookup; no token material crosses this interface. */
  isPersistentRoom?: (room: string) => boolean
  onSignal(socket: WebSocket, room: string): void
  onTunnel(socket: WebSocket, room: string): void
}
export interface HostGateway {
  port(): number | null
  listen(): Promise<number>
  close(): Promise<void>
  authorizeRoom(room: string, expiresAtMs?: number): void
}
const CAPABILITIES: PublicEndpointCapabilities = { browser: false, direct: true, tunnel: true, endpointRefresh: true }
const ROOM = /^[0-9a-f]{32}$/

export function createHostGateway(options: HostGatewayOptions): HostGateway {
  if (!['127.0.0.1', '::1', 'localhost'].includes(options.bind)) throw new Error('Host Gateway must bind to loopback')
  let listenedPort: number | null = null
  const rooms = new Map<string, number>()
  const sockets = new Set<WebSocket>()
  const occupied = new Map<string, WebSocket>()
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 })
  const server = createServer((req, res) => { void handleHttp(req, res).catch(() => json(res, 500, { error: 'internal Gateway error' })) })

  async function handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://gateway')
    if (req.method === 'GET' && (url.pathname === '/healthz' || url.pathname === '/capabilities' || url.pathname === '/.well-known/dsh-mobile')) {
      json(res, 200, { protocol: 1, hostIdentity: options.hostIdentity, capabilities: CAPABILITIES }); return
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      const asset = safeAsset(url.pathname)
      if (asset !== null) {
        res.writeHead(200, { 'content-type': asset.contentType, 'cache-control': asset.cacheControl ?? 'no-cache', 'x-content-type-options': 'nosniff' })
        res.end(req.method === 'HEAD' ? undefined : asset.body); return
      }
    }
    json(res, 404, { error: 'not found' })
  }
  function safeAsset(path: string): GatewayAsset | null {
    let decoded = path
    try {
      for (let i = 0; i < 3; i++) {
        const next = decodeURIComponent(decoded)
        if (next === decoded) break
        decoded = next
      }
    } catch { return null }
    if (decoded.includes('..') || decoded.includes('://') || decoded.includes(String.fromCharCode(92)) || !decoded.startsWith('/')) return null
    const asset = options.shellAsset?.(decoded) ?? null
    if (asset !== null && asset.contentType.includes('html')) return null
    return asset
  }
  server.on('upgrade', (req, socket, head) => {
    const path = new URL(req.url ?? '/', 'http://gateway').pathname
    if (path === '/signal/check') {
      wss.handleUpgrade(req, socket, head, ws => ws.close(1000, 'Gateway WebSocket ready')); return
    }
    const parts = path.split('/')
    const match = parts.length === 3 && (parts[1] === 'signal' || parts[1] === 'tunnel') && ROOM.test(parts[2]) ? parts : null
    if (match === null || !authorizedRoom(match[2])) { socket.write(['HTTP/1.1 401 Unauthorized', 'connection: close', '', ''].join('\r\n')); socket.destroy(); return }
    const seat = match[1] + ':' + match[2]
    const occupant = occupied.get(seat)
    if (occupant !== undefined && (occupant.readyState === 0 || occupant.readyState === 1)) {
      socket.write(['HTTP/1.1 409 Conflict', 'connection: close', '', ''].join('\r\n'))
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, ws => {
      sockets.add(ws)
      occupied.set(seat, ws)
      ws.once('close', () => {
        sockets.delete(ws)
        if (occupied.get(seat) === ws) occupied.delete(seat)
      })
      if (match[1] === 'signal') options.onSignal(ws, match[2]); else options.onTunnel(ws, match[2])
    })
  })
  function authorizedRoom(room: string): boolean {
    const expiresAt = rooms.get(room)
    if (expiresAt !== undefined) {
      if (expiresAt >= Date.now()) return true
      rooms.delete(room)
    }
    return options.isPersistentRoom?.(room) === true
  }
  return {
    port: () => listenedPort,
    authorizeRoom(room, expiresAtMs = Number.POSITIVE_INFINITY) {
      if (!ROOM.test(room)) throw new Error('Gateway room must be 128-bit hex')
      rooms.set(room, expiresAtMs)
    },
    listen: () => new Promise<number>((resolve, reject) => {
      server.once('error', reject); server.listen(options.port, options.bind, () => { server.off('error', reject); listenedPort = (server.address() as AddressInfo).port; resolve(listenedPort) })
    }),
    close: () => new Promise<void>(resolve => {
      for (const ws of sockets) ws.close(1001, 'Gateway stopping')
      server.close(() => { listenedPort = null; resolve() }); server.closeAllConnections()
    }),
  }
}
function json(res: ServerResponse, status: number, body: unknown): void { if (res.headersSent) return; res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)) }
