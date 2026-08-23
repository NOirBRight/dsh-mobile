// In-process stand-in for the M0 relay: rooms, two roles, transparent piping.
import { WebSocketServer } from 'ws'

/**
 * @returns {{ url: string, close: () => Promise<void> }} loopback relay.
 */
export async function startFakeRelay() {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  const rooms = new Map() // room -> { host?, client? }
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://relay.invalid')
    const match = url.pathname.match(/^\/r\/([A-Za-z0-9_-]{16,64})$/)
    const role = url.searchParams.get('role')
    if (!match || (role !== 'host' && role !== 'client')) { ws.close(4400); return }
    let room = rooms.get(match[1])
    if (!room) { room = { host: null, client: null }; rooms.set(match[1], room) }
    const previous = room[role]
    room[role] = ws
    if (previous && previous !== ws) {
      previous.close(4409)
      previous.terminate()
    }
    ws.on('message', (data, isBinary) => {
      const peer = room[role === 'host' ? 'client' : 'host']
      if (peer && peer.readyState === peer.OPEN) peer.send(data, { binary: isBinary })
    })
    ws.on('close', () => { if (room[role] === ws) room[role] = null })
  })
  await new Promise((resolve) => wss.on('listening', resolve))
  const { port } = wss.address()
  return {
    url: 'ws://127.0.0.1:' + port,
    close: () => new Promise((resolve) => { for (const c of wss.clients) c.terminate(); wss.close(resolve) }),
  }
}
