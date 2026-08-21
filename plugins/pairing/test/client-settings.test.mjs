import test from 'node:test'
import assert from 'node:assert/strict'
import { buildEndpointSaveRequest, decodeEndpointSaveResult, decodePairedDevices, decodePairingStatus, endpointDraftDirty, livePairedDevices, pairingQrRevisionOnToggle, pairingQrUrl, pairingRefreshQrUrl, REMOTE_SETTINGS_SECTION } from '../src/client/model.ts'

test('Remote occupies its own settings sidebar section ahead of Models', () => {
  assert.equal(REMOTE_SETTINGS_SECTION.id, 'remote')
  assert.equal(REMOTE_SETTINGS_SECTION.order, 5)
  assert.ok(REMOTE_SETTINGS_SECTION.order > 0)
  assert.ok(REMOTE_SETTINGS_SECTION.order < 10)
})

test('pairing settings status decodes endpoint and visible config location', () => {
  const status = decodePairingStatus({ endpoint: { url: 'https://quick.example', kind: 'temporary' }, endpointMode: 'quick', hostIdentity: 'host-key', configuration: { file: 'cordis.patch.yml', entryId: 'dsh-mobile-pairing', customEndpointField: 'customEndpointUrl', legacyRelayConfigured: false } })
  assert.equal(status?.endpoint?.url, 'https://quick.example')
  assert.equal(status?.configuration.entryId, 'dsh-mobile-pairing')
  assert.equal(status?.configuration.legacyRelayConfigured, false)
})

test('opening the card automatically advances to a fresh QR offer', () => {
  assert.equal(pairingQrRevisionOnToggle(7, true), 8)
  assert.equal(pairingQrRevisionOnToggle(8, false), 8)
})

test('refresh and target produce a fresh non-secret QR URL', () => {
  assert.equal(pairingQrUrl('android', 4), '/pair?target=android&format=svg&refresh=4')
  assert.equal(pairingQrUrl('android', 5), '/pair?target=android&format=svg&refresh=5')
})

test('draft is dirty only when mode or custom URL differs from the saved endpoint', () => {
  const saved = { endpointMode: 'quick', customEndpointUrl: 'https://host.example' }
  assert.equal(endpointDraftDirty('quick', '', saved), false)
  assert.equal(endpointDraftDirty('custom', 'https://host.example', saved), true)
  assert.equal(endpointDraftDirty('custom', 'https://host.example', { endpointMode: 'custom', customEndpointUrl: 'https://host.example' }), false)
  assert.equal(endpointDraftDirty('custom', ' https://host.example ', { endpointMode: 'custom', customEndpointUrl: 'https://host.example' }), false)
  assert.equal(endpointDraftDirty('custom', 'https://other.example', { endpointMode: 'custom', customEndpointUrl: 'https://host.example' }), true)
})

test('endpoint save payload and result decode staged check failures', () => {
  assert.deepEqual(buildEndpointSaveRequest('quick', 'https://ignored.example'), { endpointMode: 'quick' })
  assert.deepEqual(buildEndpointSaveRequest('custom', ' https://host.example '), { endpointMode: 'custom', customEndpointUrl: 'https://host.example' })
  assert.equal(buildEndpointSaveRequest('custom', '  ').error, 'customEndpointUrl is required in custom mode')
  assert.deepEqual(decodeEndpointSaveResult({ ok: false, stage: 'tls', error: 'certificate expired' }), { ok: false, stage: 'tls', error: 'certificate expired' })
  assert.equal(decodeEndpointSaveResult({ ok: false, stage: 'mystery', error: 'x' }), null)
})

test('paired device list keeps live rows and drops revoked ones', () => {
  const devices = decodePairedDevices({
    devices: [
      { id: 'phone', clientType: 'android', createdAt: 1, lastSeenAt: 2, revokedAt: null, room: 'a'.repeat(32) },
      { id: 'gone', clientType: 'browser', createdAt: 1, lastSeenAt: 2, revokedAt: 9 },
    ],
  })
  assert.ok(devices)
  assert.deepEqual(livePairedDevices(devices).map(device => device.id), ['phone'])
  assert.equal(pairingRefreshQrUrl('ab', 3), '/pair?format=svg&room=ab&refresh=3')
  assert.equal(decodePairedDevices({ devices: [{ id: 1 }] }), null)
})

test('malformed pairing settings status is rejected', () => {
  assert.equal(decodePairingStatus({ endpointMode: 'relay' }), null)
  assert.equal(decodePairingStatus({ endpoint: { url: 'https://x', kind: 'temporary' }, endpointMode: 'quick', hostIdentity: 'x', configuration: {} }), null)
})
