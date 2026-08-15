/**
 * Mobile web application entry: thin bootstrap over the shell library,
 * mirroring upstream apps/web/src/main.ts. When a pairing offer is present
 * (#offer= from the QR, or a stored one), the E2E tunnel comes up first and
 * the fetch/WebSocket shims route all shell traffic through it; without an
 * offer the shell boots in direct (LAN dev) mode.
 */
import { AppWebEntry } from '@deepseek-ai/dsh-client-web'
import { parseOffer, TunnelError } from '@dsh-mobile/e2e-tunnel'
import { installBadge, installShims, readOfferUrl, TunnelManager } from './tunnel.ts'

const el = document.getElementById('root')
if (el === null) throw new Error('mobile-web app: missing #root')

const offerUrl = readOfferUrl()
if (offerUrl !== null) {
  try {
    parseOffer(offerUrl) // validate up front: format and expiry
  } catch (error) {
    const msg =
      error instanceof TunnelError && error.code === 'expired'
        ? '配对二维码已过期,请在桌面端重新生成后再次扫码'
        : '配对链接无效,请重新扫码'
    el.innerHTML = '<div style="padding:2em;text-align:center;font-family:sans-serif">' + msg + '</div>'
    throw error
  }
  const mgr = new TunnelManager(offerUrl, installBadge())
  installShims(mgr)
  mgr.start()
}

void new AppWebEntry(el).run()
