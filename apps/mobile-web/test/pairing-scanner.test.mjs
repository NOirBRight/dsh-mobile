import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { scanPairingQr } from '../src/pairing-scanner.ts'

function publicUrl() {
  const offer = {
    v: 4, mode: 'public', protocol: 1,
    endpoint: 'https://host.example', endpointKind: 'temporary',
    room: 'a'.repeat(32),
    pubkey: Buffer.from(new Uint8Array(32).fill(7)).toString('base64url'),
    code: 'code', exp: Math.floor(Date.now() / 1000) + 300,
    ice: ['stun:stun.example.com:3478'],
    capabilities: { browser: false, direct: true, tunnel: true, endpointRefresh: true },
  }
  return 'dsh-mobile://pair#offer=' + Buffer.from(JSON.stringify(offer)).toString('base64url')
}

test('camera QR scan returns a validated public pairing URL', async () => {
  const url = publicUrl()
  assert.equal(await scanPairingQr(async () => ({ ScanResult: '  ' + url + '  ' }), async () => {}), url)
})

test('camera permission settles before the scanner Activity starts', async () => {
  const events = []
  const url = publicUrl()
  await scanPairingQr(async () => { events.push('scan'); return { ScanResult: url } }, async () => { events.push('permission') })
  assert.deepEqual(events, ['permission', 'scan'])
})

test('Android uses ZXing because the ML Kit backend loses successful ActivityResult on ColorOS', async () => {
  const source = await readFile(new URL('../src/pairing-scanner.ts', import.meta.url), 'utf8')
  assert.match(source, /AndroidScanningLibrary\.ZXING/)
  assert.doesNotMatch(source, /AndroidScanningLibrary\.MLKIT/)
})

test('camera QR scan rejects cancellation and unrelated QR content', async () => {
  await assert.rejects(() => scanPairingQr(async () => ({ ScanResult: '' }), async () => {}), /cancelled/)
  await assert.rejects(() => scanPairingQr(async () => ({ ScanResult: 'https://example.com/' }), async () => {}), /not a valid DSH pairing code/)
})

test('camera QR scan says the Host code expired instead of calling it invalid', async () => {
  const offer = {
    v: 4, mode: 'public', protocol: 1,
    endpoint: 'https://host.example', endpointKind: 'temporary',
    room: 'a'.repeat(32),
    pubkey: Buffer.from(new Uint8Array(32).fill(7)).toString('base64url'),
    code: 'code', exp: Math.floor(Date.now() / 1000) - 10,
    ice: ['stun:stun.example.com:3478'],
    capabilities: { browser: false, direct: true, tunnel: true, endpointRefresh: true },
  }
  const url = 'dsh-mobile://pair#offer=' + Buffer.from(JSON.stringify(offer)).toString('base64url')
  await assert.rejects(() => scanPairingQr(async () => ({ ScanResult: url }), async () => {}), /二维码已过期/)
})
