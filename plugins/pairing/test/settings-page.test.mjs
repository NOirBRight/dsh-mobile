import test from 'node:test'
import assert from 'node:assert/strict'
import { renderPairingSettingsPage } from '../src/settings-page.ts'

test('Host settings page exposes one shared HTTPS QR, rename, refresh and revocation', () => {
  const html = renderPairingSettingsPage({ hostIdentity: 'host&lt;identity', endpoint: { url: 'https://quick.example', kind: 'temporary' } })
  assert.match(html, /Public Endpoint/)
  assert.match(html, /target=browser/)
  assert.doesNotMatch(html, /target=native/)
  assert.ok(html.includes('/pair/devices'))
  assert.ok(html.includes('/pair/revoke'))
  assert.ok(html.includes('/pair/label'))
  assert.match(html, /last seen/)
  assert.match(html, /clientType/)
  assert.match(html, /room=/)
  assert.match(html, /rotateQrs/)
  assert.match(html, /App and browser scan the same HTTPS code/)
  assert.doesNotMatch(html, /host&lt;identity/)
  assert.match(html, /host&amp;lt;identity/)
})

test('Host settings page can submit a staged Custom Endpoint save', () => {
  const html = renderPairingSettingsPage({
    hostIdentity: 'host-key',
    endpoint: { url: 'https://custom.example', kind: 'custom' },
    endpointMode: 'custom',
    customEndpointUrl: 'https://custom.example',
  })
  assert.match(html, /\/pair\/endpoint/)
  assert.match(html, /TLS\/HTTP reachability/)
  assert.match(html, /WebSocket upgrade/)
  assert.match(html, /value="custom"/)
  assert.match(html, /https:\/\/custom\.example/)
  assert.match(html, /Check and save/)
})
