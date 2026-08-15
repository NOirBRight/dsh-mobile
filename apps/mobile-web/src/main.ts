/**
 * Mobile web application entry: thin bootstrap over the shell library,
 * mirroring upstream apps/web/src/main.ts. When a pairing offer is present
 * (#offer= from the QR, or a stored one), the E2E tunnel comes up first and
 * the fetch/WebSocket shims route all shell traffic through it; without an
 * offer the shell boots in direct (LAN dev) mode. The async wrapper exists
 * because the build target predates top-level await.
 */
import { AppWebEntry } from '@deepseek-ai/dsh-client-web'
import { parseOffer, TunnelError } from '@dsh-mobile/e2e-tunnel'
import { installBadge, installShims, injectBootManifestFromTunnel, readOfferUrl, TunnelManager } from './tunnel.ts'

const el = document.getElementById('root')
if (el === null) throw new Error('mobile-web app: missing #root')

void (async () => {
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
    // Progress + diagnostics while the tunnel campaign runs (a phone has no
    // devtools: state and the last error render on the boot screen itself).
    const render = (state: string, detail: string) => {
      el.innerHTML =
        '<div style="padding:2em;text-align:center;font-family:sans-serif">正在建立加密隧道…<br/>' +
        '<small style="color:#888">' + state + (detail !== '' ? ' · ' + detail : '') + '</small></div>'
    }
    let lastError = ''
    const mgr = new TunnelManager(
      offerUrl,
      (state) => { installBadge()(state); render(state, lastError) },
      (message) => { lastError = message; render('connecting', message) },
    )
    installShims(mgr)
    mgr.start()
    // The shell cannot boot without window.__DSH_BOOT__; it arrives through
    // the tunnel. Show progress meanwhile, and a readable screen on failure.
    render('connecting', '')
    try {
      const client = await mgr.current()
      await injectBootManifestFromTunnel(client)
      el.innerHTML = ''
    } catch (error) {
      el.innerHTML = '<div style="padding:2em;text-align:center;font-family:sans-serif">隧道建立失败,请检查桌面端服务后重新扫码</div>'
      throw error
    }
  }

  void new AppWebEntry(el).run()
})()
