// dsh-relay — an untrusted, multi-room sealed-frame broker.
//
// The relay never opens, parses, stores, or replays DSH frames. It only copies
// bounded binary WebSocket frames between one Host and one Client in each
// independently random room. Authentication and authorization remain inside
// the NaCl handshake carried by those opaque frames.

import { createServer } from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'

const PORT = numberEnv('PORT', 8787)
const MAX_PAYLOAD = numberEnv('MAX_PAYLOAD_BYTES', 256 * 1024)
const MAX_CONNECTIONS = numberEnv('MAX_CONNECTIONS', 2048)
const MAX_ROOMS = numberEnv('MAX_ROOMS', 4096)
const MAX_BYTES_PER_MIN = numberEnv('MAX_BYTES_PER_MIN', 16 * 1024 * 1024)
const MAX_UPGRADES_PER_IP_PER_MIN = numberEnv('MAX_UPGRADES_PER_IP_PER_MIN', 120)
const PING_INTERVAL_MS = numberEnv('PING_INTERVAL_MS', 30_000)
const EMPTY_ROOM_TTL_MS = numberEnv('EMPTY_ROOM_TTL_MS', 10 * 60_000)
const ROOM = /^[0-9a-f]{32}$/
const ROLES = new Set(['host', 'client'])

/** @type {Map<string, { host: WebSocket | null, client: WebSocket | null, emptySince: number }>} */
const rooms = new Map()
/** @type {Set<WebSocket>} */
const sockets = new Set()
/** @type {Map<string, { count: number, resetAt: number }>} */
const upgradeBuckets = new Map()

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
    res.end('ok')
    return
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  res.end()
})

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD, perMessageDeflate: false })

server.on('upgrade', (req, socket, head) => {
  const reject = (status) => {
    socket.write('HTTP/1.1 ' + status + '\r\nConnection: close\r\n\r\n')
    socket.destroy()
  }
  const url = new URL(req.url ?? '/', 'http://relay.invalid')
  const match = url.pathname.match(/^\/r\/([0-9a-f]{32})\/?$/)
  const role = url.searchParams.get('role')
  if (match === null || !ROLES.has(role ?? '')) return reject('400 Bad Request')
  if (sockets.size >= MAX_CONNECTIONS) return reject('503 Service Unavailable')
  if (!rooms.has(match[1]) && rooms.size >= MAX_ROOMS) return reject('503 Service Unavailable')

  const ip = requestIp(req)
  const now = Date.now()
  let bucket = upgradeBuckets.get(ip)
  if (bucket === undefined || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + 60_000 }
    upgradeBuckets.set(ip, bucket)
  }
  if (++bucket.count > MAX_UPGRADES_PER_IP_PER_MIN) return reject('429 Too Many Requests')

  wss.handleUpgrade(req, socket, head, ws => joinRoom(match[1], /** @type {'host'|'client'} */ (role), ws))
})

/** @param {string} roomId @param {'host'|'client'} role @param {WebSocket} ws */
function joinRoom(roomId, role, ws) {
  let room = rooms.get(roomId)
  if (room === undefined) {
    room = { host: null, client: null, emptySince: 0 }
    rooms.set(roomId, room)
  }
  const previous = room[role]
  room[role] = ws
  room.emptySince = 0
  sockets.add(ws)
  ws.meta = { roomId, role, lastSeen: Date.now(), bytes: 0, byteResetAt: Date.now() + 60_000 }
  if (previous !== null && previous !== ws) {
    sockets.delete(previous)
    previous.close(4409, 'room role replaced')
    previous.terminate()
  }

  ws.on('pong', () => { ws.meta.lastSeen = Date.now() })
  ws.on('message', (data, isBinary) => {
    ws.meta.lastSeen = Date.now()
    // Official Relay carries only opaque binary tunnel frames. It must never
    // become a generic text/signaling or HTTP proxy by accident.
    if (!isBinary) {
      ws.close(4400, 'binary sealed frames required')
      return
    }
    const now = Date.now()
    if (now >= ws.meta.byteResetAt) {
      ws.meta.bytes = 0
      ws.meta.byteResetAt = now + 60_000
    }
    const frame = Buffer.isBuffer(data) ? data : Buffer.from(data)
    ws.meta.bytes += frame.length
    if (ws.meta.bytes > MAX_BYTES_PER_MIN) {
      ws.close(4429, 'relay byte rate exceeded')
      return
    }
    const peer = room[role === 'host' ? 'client' : 'host']
    if (peer === null || peer.readyState !== WebSocket.OPEN) return
    if (peer.bufferedAmount > MAX_PAYLOAD * 8) {
      ws.close(4429, 'peer backpressure exceeded')
      return
    }
    peer.send(frame, { binary: true })
  })
  const leave = () => {
    sockets.delete(ws)
    if (room[role] !== ws) return
    room[role] = null
    if (room.host === null && room.client === null) room.emptySince = Date.now()
    log(roomId, role + ' left (' + ws.meta.bytes + 'B relayed)')
  }
  ws.on('close', leave)
  ws.on('error', () => {})
  log(roomId, role + ' joined')
}

const reaper = setInterval(() => {
  const now = Date.now()
  for (const [roomId, room] of rooms) {
    for (const role of ['host', 'client']) {
      const ws = room[role]
      if (ws === null || ws.readyState !== WebSocket.OPEN) continue
      // Ping keeps NAT/load-balancer mappings alive. Missed pongs never
      // evict a seat: phones and carrier proxies often swallow ping/pong
      // while the TCP session is still the live one. A later join for the
      // same role replaces a zombie; TCP close still clears a real hangup.
      ws.ping()
    }
    if (room.host === null && room.client === null && room.emptySince > 0 && now - room.emptySince > EMPTY_ROOM_TTL_MS) {
      rooms.delete(roomId)
    }
  }
  for (const [ip, bucket] of upgradeBuckets) {
    if (now >= bucket.resetAt) upgradeBuckets.delete(ip)
  }
}, PING_INTERVAL_MS)
reaper.unref()

function requestIp(req) {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded !== '') return forwarded.split(',')[0].trim()
  return req.socket.remoteAddress ?? 'unknown'
}

/** @param {string} name @param {number} fallback */
function numberEnv(name, fallback) {
  const value = Number(process.env[name])
  return Number.isSafeInteger(value) && value > 0 ? value : fallback
}

/** @param {string} roomId @param {string} message */
function log(roomId, message) {
  console.log('[' + new Date().toISOString() + '] room ' + roomId.slice(0, 8) + '… ' + message)
}

server.listen(PORT, () => console.log('dsh-relay listening on :' + PORT + ' (opaque sealed frames only)'))

function shutdown() {
  clearInterval(reaper)
  for (const ws of sockets) ws.close(1001, 'Relay stopping')
  server.close(() => process.exit(0))
}
process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)
