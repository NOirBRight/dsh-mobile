import test from 'node:test'
import assert from 'node:assert/strict'
import { renderPairingSettingsPage } from '../src/settings-page.ts'

test('Host settings page exposes one shared HTTPS QR, rename, refresh and revocation', () => {
  const html = renderPairingSettingsPage({ hostIdentity: 'host&lt;identity', endpoint: { url: 'https://quick.example', kind: 'temporary' } })
  for (const snippet of ['Connection method', 'Generate automatically', 'Connection address', '/pair/devices', '/pair/revoke', '/pair/label', 'last seen', 'clientType', 'rotateQrs']) {
    assert.ok(html.includes(snippet), 'missing ' + snippet)
  }
  assert.equal(html.includes('href="/mobile"'), false)
  assert.equal(html.includes('/mobile'), false)
  assert.equal(html.includes('target=browser'), false)
  assert.equal(html.includes('>host&lt;identity<'), false)
  assert.ok(html.includes('host&amp;lt;identity'))
})

test('Host settings page does not request a QR before an endpoint is ready', () => {
  const html = renderPairingSettingsPage({ hostIdentity: 'host-key', endpoint: null, endpointMode: 'relay', relayUrl: 'wss://relay.example' })
  assert.ok(html.includes('qr-placeholder'))
  assert.equal(html.includes('src="/pair?format=svg'), false)
})

test('Host settings page accepts a user-provided connection service address', () => {
  const html = renderPairingSettingsPage({
    hostIdentity: 'host-key',
    endpoint: { url: 'wss://service.example', kind: 'relay' },
    endpointMode: 'relay',
    endpointState: 'ready',
    relayUrl: 'wss://service.example',
  })
  for (const snippet of ['/pair/endpoint', 'value="relay"', 'type="url"', 'value="wss://service.example"', 'Generate code', 'How to deploy your own connection service']) {
    assert.ok(html.includes(snippet), 'missing ' + snippet)
  }
  assert.equal(html.includes('<select'), false)
  assert.equal(html.includes('relay.noirbright.top'), false)
  assert.ok(html.includes('data-state="loading"'))
  assert.ok(html.includes('id="retry-qr"'))
})

test('Host settings page shows a QR for a live custom endpoint and rotates it every 20 seconds', () => {
  const html = renderPairingSettingsPage({
    hostIdentity: 'host-key',
    endpoint: { url: 'https://pair.example', kind: 'custom' },
    endpointMode: 'custom',
    endpointState: 'ready',
  })
  assert.ok(html.includes('src="/pair?format=svg'))
  assert.ok(html.includes('setInterval(rotateQrs,20000)'))
})

test('Host settings page animates address generation before requesting a QR', () => {
  const html = renderPairingSettingsPage({ hostIdentity: 'host-key', endpoint: null, endpointMode: 'quick', endpointState: 'loading' })
  assert.ok(html.includes('Generating address and code…'))
  assert.ok(html.includes('@keyframes qr-spin'))
  assert.equal(html.includes('src="/pair?format=svg'), false)
})
