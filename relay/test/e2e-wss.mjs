// E2E: two WSS clients through the public sealed Relay exchange opaque frames.
// Usage: RELAY_URL=wss://relay.example.com node test/e2e-wss.mjs
import { once } from 'node:events'
import { randomBytes } from 'node:crypto'
import assert from 'node:assert/strict'
import WebSocket from 'ws'

const base = process.env.RELAY_URL ?? 'ws://127.0.0.1:8787'
const room = randomBytes(16).toString('hex')
const url = (role) => base + '/r/' + room + '?role=' + role
const open = (u) => { const ws = new WebSocket(u); return once(ws, 'open').then(() => ws) }

const health = await fetch(base.replace(/^ws/, 'http') + '/healthz')
assert.equal(health.status, 200, 'healthz')

const host = await open(url('host'))
const client = await open(url('client'))
const hostGot = once(host, 'message')
client.send(Buffer.from('e2e-ping'))
assert.equal(String((await hostGot)[0]), 'e2e-ping')
const clientGot = once(client, 'message')
host.send(Buffer.from('e2e-pong'))
assert.equal(String((await clientGot)[0]), 'e2e-pong')
host.close(); client.close()
console.log('E2E PASS via ' + base + ' (room ' + room.slice(0, 8) + '…)')
