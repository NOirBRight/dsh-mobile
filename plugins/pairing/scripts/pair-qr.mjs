#!/usr/bin/env node
// Print the pairing QR in a terminal — no GUI required.
//
//   node scripts/pair-qr.mjs --live [baseUrl]   fetch the offer from a running dsh (default http://127.0.0.1:3080)
//   node scripts/pair-qr.mjs [--port N]         offline ephemeral offer, for QR/fragment format checks only
//
// Offline mode mints its code in THIS process: nothing can ever exchange it.
// It exists so the QR content and URL-fragment format can be eyeballed without
// a running harness; the code path (keypair, offer, fragment) is the plugin's.
import { networkInterfaces, homedir } from 'node:os'
import { join } from 'node:path'
import QRCode from 'qrcode'
import { loadOrCreateKeypair } from '../src/keys.ts'
import { PairingOfferManager, buildOfferUrl } from '../src/pairing.ts'

const args = process.argv.slice(2)
const liveAt = args.indexOf('--live')
const portAt = args.indexOf('--port')
// Product default: native app deep link. Set DSH_MOBILE_APP_URL explicitly
// when checking an independently deployed HTTPS browser shell.
const appUrl = process.env.DSH_MOBILE_APP_URL ?? 'dsh-mobile://pair'

async function printQr(url) {
  console.log(await QRCode.toString(url, { type: 'terminal', small: true }))
  console.log(url)
}

if (liveAt !== -1) {
  const base = args[liveAt + 1] && !args[liveAt + 1].startsWith('--') ? args[liveAt + 1] : 'http://127.0.0.1:3080'
  const res = await fetch(base + '/pair')
  if (!res.ok) {
    console.error('GET ' + base + '/pair → HTTP ' + res.status + ': ' + (await res.text()))
    process.exit(1)
  }
  const payload = await res.json()
  await printQr(payload.offerUrl)
} else {
  const port = portAt !== -1 ? Number(args[portAt + 1]) : 0
  const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const keypair = loadOrCreateKeypair(join(dshHome, 'mobile', 'daemon-keypair.json'))
  const lan = firstLanIPv4() ?? '127.0.0.1'
  const offers = new PairingOfferManager(300_000)
  const offer = offers.mint('lan', 'http://' + lan + ':' + port, null, keypair.publicKeyBase64Url)
  console.error('offline mode: this code lives only in this process and cannot be exchanged;')
  console.error('run with --live against a running dsh for a real pairing. Port is 0 unless --port is given.')
  await printQr(buildOfferUrl(appUrl, offer))
}

function firstLanIPv4() {
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) return ni.address
    }
  }
  return null
}
