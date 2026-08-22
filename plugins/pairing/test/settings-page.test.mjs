import test from 'node:test'
import assert from 'node:assert/strict'
import { renderPairingSettingsPage } from '../src/settings-page.ts'

test('Host settings page exposes one shared HTTPS QR, rename, refresh and revocation', () => {
  const html = renderPairingSettingsPage({ hostIdentity: 'host&lt;identity', endpoint: { url: 'https://quick.example', kind: 'temporary' } })
  for (const snippet of ['Public Endpoint', '/pair/devices', '/pair/revoke', '/pair/label', 'last seen', 'clientType', 'rotateQrs', 'Relay']) {
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

test('Host settings page exposes the two configured Relay regions', () => {
  const html = renderPairingSettingsPage({
    hostIdentity: 'host-key',
    endpoint: { url: 'wss://relay.noirbright.top', kind: 'relay' },
    endpointMode: 'relay',
    relayUrl: 'wss://relay.noirbright.top',
  })
  for (const snippet of ['/pair/endpoint', 'Relay health', 'value="relay"', 'relay-overseas.noirbright.top', 'Check and save']) {
    assert.ok(html.includes(snippet), 'missing ' + snippet)
  }
})
