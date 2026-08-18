// dsh-signaling — untrusted WebRTC signaling rooms.
//
// Forwards only small JSON signaling envelopes between one host and one client.
// The envelope payload is base64url-encoded SDP JSON. This process validates only
// the bounded outer shape; endpoint authentication remains the NaCl hello sent over
// the resulting DataChannel. Binary and arbitrary text are rejected so this server
// cannot silently become a DSH data relay. The room id
// in the URL is the only capability; it is minted by the pairing host inside
// a QR code and never travels anywhere else.
//
// Routes (behind Caddy handle_path /relay*, which strips the prefix):
//   GET  /healthz                      → 200 "ok"
//   WS   /r/<roomId>?role=host|client  → join room; frames pipe to the peer
//
// Room rules: at most one host and one client per room; a third party is
// closed with 4409. A departing side does NOT take the peer down — the
// remaining side stays connected so a phone can roam and rejoin the same
// room; the E2E layer owns session resumption. Fully empty rooms are GC'd.

import { createServer } from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'

const PORT = Number(process.env.PORT ?? 8787)
const MAX_PAYLOAD = 64 * 1024 // encrypted SDP/ICE only; application frames never belong here
const MAX_SIGNALS_PER_MIN = 64
const SIGNAL_PAYLOAD = /^[A-Za-z0-9_-]+$/
const SDP_PREFIX = 'v=0'
const PING_INTERVAL_MS = 30_000
const EMPTY_ROOM_TTL_MS = 10 * 60_000
const MAX_UPGRADES_PER_IP_PER_MIN = 100

/** @type {Map<string, { host: WebSocket | null, client: WebSocket | null, emptySince: number }>} */
const rooms = new Map()
/** @type {Map<string, { count: number, resetAt: number }>} */
const upgradeBuckets = new Map()

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('ok')
    return
  }
  res.writeHead(404)
  res.end()
})

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD })

server.on('upgrade', (req, socket, head) => {
  const reject = (status) => {
    socket.write(`HTTP/1.1 ${status}\r\nconnection: close\r\n\r\n`)
    socket.destroy()
  }
  const url = new URL(req.url ?? '/', 'http://relay.invalid')
  const match = url.pathname.match(/^\/r\/([A-Za-z0-9_-]{16,64})\/?$/)
  const role = url.searchParams.get('role')
  if (!match || (role !== 'host' && role !== 'client')) return reject('400 Bad Request')

  const ip = req.socket.remoteAddress ?? 'unknown'
  const now = Date.now()
  let bucket = upgradeBuckets.get(ip)
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + 60_000 }
    upgradeBuckets.set(ip, bucket)
  }
  if (++bucket.count > MAX_UPGRADES_PER_IP_PER_MIN) return reject('429 Too Many Requests')

  wss.handleUpgrade(req, socket, head, (ws) => joinRoom(match[1], role, ws))
})

/**
 * @param {string} roomId
 * @param {'host' | 'client'} role
 * @param {WebSocket} ws
 */
function joinRoom(roomId, role, ws) {
  let room = rooms.get(roomId)
  if (!room) {
    room = { host: null, client: null, emptySince: 0 }
    rooms.set(roomId, room)
  }
  if (room[role]) {
    ws.close(4409, 'role occupied')
    return
  }
  room[role] = ws
  room.emptySince = 0
  ws.meta = { roomId, role, alive: true, bytes: 0, signals: 0, signalResetAt: Date.now() + 60_000 }
  log(roomId, role + ' joined')

  ws.on('pong', () => { ws.meta.alive = true })
  ws.on('message', (data, isBinary) => {
    if (isBinary) { ws.close(4400, 'signaling envelopes must be text'); return }
    let message
    try { message = JSON.parse(data.toString()) } catch { ws.close(4400, 'invalid signaling envelope'); return }
    if (
      message === null || typeof message !== 'object' ||
      message.type !== 'signal' || message.phase !== 'sdp' ||
      Object.keys(message).sort().join(',') !== 'payload,phase,type' ||
      typeof message.payload !== 'string' || message.payload.length === 0 ||
      !SIGNAL_PAYLOAD.test(message.payload) ||
      !isRoleSdpPayload(message.payload, role)
    ) {
      ws.close(4400, 'invalid signaling envelope')
      return
    }
    const now = Date.now()
    if (now >= ws.meta.signalResetAt) { ws.meta.signals = 0; ws.meta.signalResetAt = now + 60_000 }
    if (++ws.meta.signals > MAX_SIGNALS_PER_MIN) { ws.close(4429, 'signaling rate exceeded'); return }
    ws.meta.bytes += data.length
    const peer = room[role === 'host' ? 'client' : 'host']
    if (peer && peer.readyState === WebSocket.OPEN) peer.send(data.toString())
  })
  const leave = () => {
    if (room[role] !== ws) return
    room[role] = null
    log(roomId, role + ' left (' + ws.meta.bytes + 'B relayed)')
    if (!room.host && !room.client) room.emptySince = Date.now()
  }
  ws.on('close', leave)
  ws.on('error', () => {}) // close follows every error; leave() owns the bookkeeping
}


/** @param {string} encoded @param {'host' | 'client'} role */
function isRoleSdpPayload(encoded, role) {
  try {
    const signal = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
    if (signal === null || typeof signal !== 'object') return false
    if (Object.keys(signal).sort().join(',') !== 'description,kind') return false
    const expected = role === 'client' ? 'offer' : 'answer'
    const description = signal.description
    return signal.kind === expected &&
      description !== null && typeof description === 'object' &&
      Object.keys(description).sort().join(',') === 'sdp,type' &&
      description.type === expected &&
      typeof description.sdp === 'string' &&
      description.sdp.startsWith(SDP_PREFIX) &&
      !description.sdp.includes('\0')
  } catch {
    return false
  }
}

const reaper = setInterval(() => {
  const now = Date.now()
  for (const [roomId, room] of rooms) {
    for (const role of ['host', 'client']) {
      const ws = room[role]
      if (!ws) continue
      if (!ws.meta.alive) { ws.terminate(); continue }
      ws.meta.alive = false
      ws.ping()
    }
    if (!room.host && !room.client && room.emptySince && now - room.emptySince > EMPTY_ROOM_TTL_MS) {
      rooms.delete(roomId)
    }
  }
  for (const [ip, bucket] of upgradeBuckets) {
    if (now > bucket.resetAt) upgradeBuckets.delete(ip)
  }
}, PING_INTERVAL_MS)
reaper.unref()

/** @param {string} roomId @param {string} msg */
function log(roomId, msg) {
  console.log('[' + new Date().toISOString() + '] room ' + roomId.slice(0, 8) + '… ' + msg)
}

server.listen(PORT, () => log('--------', 'listening on :' + PORT))
