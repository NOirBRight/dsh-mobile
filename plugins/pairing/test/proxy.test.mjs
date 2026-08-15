// Auth reverse proxy behavior: 401 wall, Host rewrite, Bearer and subprotocol
// auth, WS piping. Upstream is an in-process dummy; no dsh, no API key.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocketServer, WebSocket } from 'ws'
import { DeviceTokenStore } from '../src/tokens.ts'
import { createAuthProxy } from '../src/proxy.ts'

let dir, store, token, upstream, upstreamPort, proxy, proxyPort
let lastUpgradeHeaders = null

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-proxy-'))
  store = new DeviceTokenStore(join(dir, 'devices.json'))
  token = store.issue('test-phone').token

  const wss = new WebSocketServer({ noServer: true })
  upstream = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/body') {
      const chunks = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.end(Buffer.concat(chunks))
      })
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ host: req.headers.host, authorization: req.headers.authorization ?? null, url: req.url }))
  })
  upstream.on('upgrade', (req, socket, head) => {
    lastUpgradeHeaders = req.headers
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.on('message', (m) => ws.send('echo:' + m))
    })
  })
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r))
  upstreamPort = upstream.address().port

  proxy = createAuthProxy({ bind: '127.0.0.1', port: 0, upstreamHost: '127.0.0.1', upstreamPort, tokenStore: store })
  proxyPort = await proxy.listen()
})

after(async () => {
  await proxy.close()
  upstream.close()
  rmSync(dir, { recursive: true, force: true })
})

const url = (path) => 'http://127.0.0.1:' + proxyPort + path

test('healthz is the only unauthenticated endpoint', async () => {
  const res = await fetch(url('/healthz'))
  assert.equal(res.status, 200)
  assert.equal(await res.text(), 'ok')
})

test('HTTP without a token gets 401', async () => {
  const res = await fetch(url('/api/describe'))
  assert.equal(res.status, 401)
  assert.deepEqual(await res.json(), { error: 'unauthorized' })
})

test('HTTP with a wrong token gets 401', async () => {
  const res = await fetch(url('/api/describe'), { headers: { authorization: 'Bearer wrong' } })
  assert.equal(res.status, 401)
})

test('Bearer token passes; Host is rewritten to the loopback authority; credential headers do not cross', async () => {
  const res = await fetch(url('/api/describe'), { headers: { authorization: 'Bearer ' + token } })
  assert.equal(res.status, 200)
  const seen = await res.json()
  assert.equal(seen.url, '/api/describe')
  assert.equal(seen.host, '127.0.0.1:' + upstreamPort) // the upstream fence sees loopback
  assert.equal(seen.authorization, null) // the device token never reaches the upstream
})

test('POST bodies stream through', async () => {
  const res = await fetch(url('/body'), { method: 'POST', headers: { authorization: 'Bearer ' + token }, body: 'x'.repeat(100_000) })
  assert.equal(res.status, 200)
  assert.equal((await res.text()).length, 100_000)
})

test('revoked token gets 401', async () => {
  const { id, token: doomed } = store.issue('doomed')
  assert.equal(store.revoke(id), true)
  const res = await fetch(url('/api/describe'), { headers: { authorization: 'Bearer ' + doomed } })
  assert.equal(res.status, 401)
})

test('WS upgrade without a subprotocol token is rejected', async () => {
  const ws = new WebSocket('ws://127.0.0.1:' + proxyPort + '/api/events.mux')
  await assert.rejects(once(ws, 'open'), /401/)
})

test('WS upgrade with a wrong subprotocol token is rejected', async () => {
  const ws = new WebSocket('ws://127.0.0.1:' + proxyPort + '/api/events.mux', ['dsh-mobile.wrong'])
  await assert.rejects(once(ws, 'open'), /401/)
})

test('WS with a valid subprotocol token connects, pipes, and hides auth from the upstream', async () => {
  lastUpgradeHeaders = null
  const ws = new WebSocket('ws://127.0.0.1:' + proxyPort + '/api/events.mux', ['dsh-mobile.' + token])
  await once(ws, 'open')
  const got = once(ws, 'message')
  ws.send('hello')
  assert.equal(String((await got)[0]), 'echo:hello')
  assert.equal(lastUpgradeHeaders.host, '127.0.0.1:' + upstreamPort) // rewritten
  assert.ok(!String(lastUpgradeHeaders['sec-websocket-protocol'] ?? '').includes('dsh-mobile.')) // consumed by the proxy
  ws.close()
})
