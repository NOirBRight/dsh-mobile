import test from 'node:test'
import assert from 'node:assert/strict'
import { PAIRING_QR_QUIET_ZONE_MODULES, renderPairingQrSvg } from '../src/qr.ts'

test('pairing QR keeps the ISO four-module quiet zone', async () => {
  assert.equal(PAIRING_QR_QUIET_ZONE_MODULES, 4)
  const svg = await renderPairingQrSvg('dsh-mobile://pair#offer=' + 'A'.repeat(500))
  assert.match(svg, /<path stroke="#000000" d="M4 4\.5h7/)
})
