import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkCustomEndpoint, validateCustomEndpoint } from '../src/public-endpoint.ts'

test('custom endpoint accepts only credential-free HTTPS operator URLs', () => {
  assert.equal(validateCustomEndpoint('https://host.example/path/'), 'https://host.example/path')
  assert.throws(() => validateCustomEndpoint('http://host.example'), /HTTPS/)
  assert.throws(() => validateCustomEndpoint('https://user:secret@host.example'), /credentials/)
})

test('custom endpoint checks report the exact failed stage', async () => {
  const result = await checkCustomEndpoint('https://host.example', {
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ protocol: 2 }) }),
    openWebSocket: async () => ({ close() {} }),
  })
  assert.deepEqual(result, { ok: false, stage: 'protocol', error: 'unsupported Gateway protocol 2' })
})

test('custom endpoint checks name every failing stage', async () => {
  assert.equal((await checkCustomEndpoint('not-a-url', { fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }), openWebSocket: async () => ({ close() {} }) })).stage, 'endpoint')
  assert.equal((await checkCustomEndpoint('https://host.example', { fetch: async () => { throw new Error('getaddrinfo') }, openWebSocket: async () => ({ close() {} }) })).stage, 'tls')
  assert.equal((await checkCustomEndpoint('https://host.example', { fetch: async () => ({ ok: false, status: 502, json: async () => ({}) }), openWebSocket: async () => ({ close() {} }) })).stage, 'tls')
  assert.equal((await checkCustomEndpoint('https://host.example', { fetch: async () => ({ ok: true, status: 200, json: async () => { throw new Error('no json') } }), openWebSocket: async () => ({ close() {} }) })).stage, 'identity')
  assert.equal((await checkCustomEndpoint('https://host.example', { fetch: async () => ({ ok: true, status: 200, json: async () => ({ protocol: 1 }) }), openWebSocket: async () => ({ close() {} }) })).stage, 'identity')
  assert.equal((await checkCustomEndpoint('https://host.example', { fetch: async () => ({ ok: true, status: 200, json: async () => ({ protocol: 1, hostIdentity: 'k', capabilities: {} }) }), openWebSocket: async () => ({ close() {} }) })).stage, 'capabilities')
  assert.equal((await checkCustomEndpoint('https://host.example', {
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ protocol: 1, hostIdentity: 'k', capabilities: { browser: false, direct: true, tunnel: true, endpointRefresh: true } }) }),
    openWebSocket: async () => { throw new Error('upgrade failed') },
  })).stage, 'websocket')
})

test('custom endpoint checks validate HTTP identity/capabilities then WebSocket upgrade', async () => {
  const opened = []
  const result = await checkCustomEndpoint('https://host.example/', {
    fetch: async (url) => {
      assert.equal(url, 'https://host.example/.well-known/dsh-mobile')
      return { ok: true, status: 200, json: async () => ({ protocol: 1, hostIdentity: 'host-key', capabilities: { browser: false, direct: true, tunnel: true, endpointRefresh: true } }) }
    },
    openWebSocket: async (url) => { opened.push(url); return { close() {} } },
  })
  assert.deepEqual(result, { ok: true, stage: 'ready', hostIdentity: 'host-key', capabilities: { browser: false, direct: true, tunnel: true, endpointRefresh: true } })
  assert.deepEqual(opened, ['wss://host.example/signal/check'])
})

test('custom endpoint checks reject a retired browser capability', async () => {
  const result = await checkCustomEndpoint('https://host.example', {
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ protocol: 1, hostIdentity: 'k', capabilities: { browser: true, direct: true, tunnel: true, endpointRefresh: true } }) }),
    openWebSocket: async () => ({ close() {} }),
  })
  assert.equal(result.ok, false)
  assert.equal(result.stage, 'capabilities')
})
