import test from 'node:test'
import assert from 'node:assert/strict'
import { renderPairingSettingsPage } from '../src/settings-page.ts'

test('Host settings page exposes one shared HTTPS QR, rename, refresh and revocation', () => {
  const html = renderPairingSettingsPage({ hostIdentity: 'host&lt;identity', endpoint: { url: 'https://quick.example', kind: 'temporary' } })
  for (const snippet of ['Public Endpoint', '/pair/devices', '/pair/revoke', '/pair/label', 'last seen', 'clientType', 'rotateQrs']) {
    assert.ok(html.includes(snippet), 'missing ' + snippet)
  }
  assert.equal(html.includes('href="/mobile"'), false)
  assert.equal(html.includes('/mobile'), false)
  assert.equal(html.includes('target=browser'), false)
  assert.equal(html.includes('>host&lt;identity<'), false)
  assert.ok(html.includes('host&amp;lt;identity'))
})

test('Host settings page can submit a staged Custom Endpoint save', () => {
  const html = renderPairingSettingsPage({
    hostIdentity: 'host-key',
    endpoint: { url: 'https://custom.example', kind: 'custom' },
    endpointMode: 'custom',
    customEndpointUrl: 'https://custom.example',
  })
  for (const snippet of ['/pair/endpoint', 'TLS/HTTP reachability', 'WebSocket upgrade', 'value="custom"', 'https://custom.example', 'Check and save']) {
    assert.ok(html.includes(snippet), 'missing ' + snippet)
  }
})
