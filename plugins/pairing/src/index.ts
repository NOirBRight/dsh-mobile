/** Host-owned Public Endpoint and bounded loopback Gateway plugin. */
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { renderPairingQrSvg } from './qr.js'
import z from '@deepseek-ai/schemastery'
import { Config, resolveConfig } from './config.ts'
import { loadOrCreateKeypair } from './keys.ts'
import { DeviceTokenStore } from './tokens.ts'
import { PairingOfferManager, buildCompactPublicOfferUrl, buildOfferUrl } from './pairing.ts'
import { attachHandshakeTransport, attachRelaySocket } from './tunnel-server.ts'
import { attachDirectSignaling } from './direct-signaling.ts'
import { WeriftDataChannelTransport } from './webrtc-transport.ts'
import { createHostGateway, type GatewayEndpoint } from './gateway.ts'
import { QuickTunnelController, type QuickTunnelStatus } from './quick-tunnel.ts'
import { validateCustomEndpoint, createNodeCustomEndpointAdapters } from './public-endpoint.ts'
import { applyPublicEndpointSelection, loadPublicEndpointOverlay, parseEndpointSelection, savePublicEndpointOverlay } from './endpoint-settings.ts'
import { renderPairingSettingsPage } from './settings-page.ts'

export const name = 'dsh-mobile-pairing'
export const inject = ['webServer', 'settings']
interface PairingWebServer { register(route: WebRoute): () => void }
export { Config, resolveConfig } from './config.ts'
export { loadOrCreateKeypair } from './keys.ts'; export type { DaemonKeypair } from './keys.ts'
export { DeviceTokenStore, DeviceLimitError, MAX_LIVE_DEVICES } from './tokens.ts'; export type { DeviceClientType, DeviceRecord } from './tokens.ts'
export { PairingOfferManager, buildCompactPublicOfferUrl, buildOfferUrl, parseOfferUrl } from './pairing.ts'
export type { MintPublicOfferOptions, PairingOfferPayload, PublicEndpointCapabilities, PublicPairingOfferPayload } from './pairing.ts'
export { createAuthProxy, WS_AUTH_PREFIX } from './proxy.ts'; export type { AuthProxy, AuthProxyOptions } from './proxy.ts'
export { hostHandshake } from './handshake.ts'; export type { HandshakeDeps, HandshakeOutcome } from './handshake.ts'
/** Legacy compatibility export only; product runtime never instantiates it. */
export { createRelayConnector } from './relay-connector.ts'; export type { RelayConnector, RelayConnectorOptions } from './relay-connector.ts'
export { attachHandshakeTransport, attachRelaySocket } from './tunnel-server.ts'; export type { RelaySocketGate, TunnelEndpointOptions } from './tunnel-server.ts'
export { attachDirectSignaling, encodeSignalDescription } from './direct-signaling.ts'; export type { DirectSignalingGate, DirectSignalingOptions } from './direct-signaling.ts'
export { WeriftDataChannelTransport } from './webrtc-transport.ts'
export { createHostGateway } from './gateway.ts'; export type { GatewayAsset, GatewayEndpoint, HostGateway, HostGatewayOptions } from './gateway.ts'
export { QuickTunnelController, CLOUDFLARED_QUICK_PROVIDER } from './quick-tunnel.ts'; export type { QuickTunnelChild, QuickTunnelOptions, QuickTunnelProvider, QuickTunnelStatus } from './quick-tunnel.ts'
export { checkCustomEndpoint, createNodeCustomEndpointAdapters, validateCustomEndpoint } from './public-endpoint.ts'; export type { CustomEndpointAdapters, CustomEndpointCheck } from './public-endpoint.ts'
export { applyPublicEndpointSelection, loadPublicEndpointOverlay, parseEndpointSelection, savePublicEndpointOverlay } from './endpoint-settings.ts'
export type { PublicEndpointApplyResult, PublicEndpointSelection } from './endpoint-settings.ts'
export { renderPairingSettingsPage } from './settings-page.ts'; export type { PairingSettingsPageOptions } from './settings-page.ts'

export function apply(ctx: Context, config: Config): void {
  const webServer = (ctx as unknown as { webServer: PairingWebServer }).webServer
  const settings = (ctx as unknown as { settings?: { register(ns: string, schema: unknown): unknown } }).settings
  settings?.register('dsh-mobile', z.object({}))
  const resolved = resolveConfig(config)
  const overlayPath = join(resolved.dshHome, 'mobile', 'public-endpoint.json')
  const overlay = loadPublicEndpointOverlay(overlayPath)
  const live = {
    mode: overlay?.endpointMode ?? resolved.endpointMode,
    customUrl: overlay?.customEndpointUrl ?? resolved.customEndpointUrl,
  }
  const keypair = loadOrCreateKeypair(resolved.keyStorePath)
  const store = new DeviceTokenStore(resolved.tokenStorePath)
  const offers = new PairingOfferManager(resolved.codeTtlMs)
  let endpoint: GatewayEndpoint | null = live.mode === 'custom' ? { url: validateCustomEndpoint(live.customUrl as string), kind: 'custom' } : null
  let localGateway: string | null = null
  function tunnelOptions(room: string) { return { upstreamHost: resolved.dshHost, upstreamPort: resolved.dshPort, handshake: { keypair, offers, devices: store, room }, logger: (message: string) => ctx.logger.info('dsh-mobile-pairing: ' + message) } }
  const gateway = createHostGateway({
    bind: resolved.gatewayBind, port: resolved.gatewayPort, hostIdentity: keypair.publicKeyBase64Url,
    isPersistentRoom: room => store.hasLiveForRoom(room),
    onSignal: (socket, room) => { attachDirectSignaling(socket, { iceServers: resolved.stunUrls.map(url => ({ urls: url })), onChannel: channel => { attachHandshakeTransport(new WeriftDataChannelTransport(channel), tunnelOptions(room)) }, onError: error => ctx.logger.error(error) }) },
    onTunnel: (socket, room) => { attachRelaySocket(socket, tunnelOptions(room)) },
  })
  for (const room of store.liveRooms()) gateway.authorizeRoom(room)
  let quick: QuickTunnelController | null = null
  function onQuickStatus(status: QuickTunnelStatus): void {
    if (status.state === 'ready' || status.state === 'rotated') endpoint = { url: status.endpoint, kind: 'temporary' }
    if (status.state === 'error' || status.state === 'stopped') endpoint = null
    if (status.state === 'error') ctx.logger.error(new Error('dsh-mobile-pairing: ' + status.error))
    else ctx.logger.info('dsh-mobile-pairing: Quick Tunnel ' + status.state + ('endpoint' in status ? ' ' + status.endpoint : ''))
  }
  function startQuickTunnel(local: string): void {
    quick = new QuickTunnelController({
      spawn: (command, args) => spawn(command === 'cloudflared' ? resolved.cloudflaredPath : command, args, { stdio: ['ignore', 'pipe', 'pipe'] }),
      provider: {
        command: resolved.quickTunnelCommand ?? 'cloudflared',
        args: local => (resolved.quickTunnelArgs ?? ['tunnel', '--url', '{gateway}', '--no-autoupdate']).map(part => part.replaceAll('{gateway}', local)),
        ...(resolved.quickTunnelEndpointPattern === undefined ? {} : { endpointPattern: new RegExp(resolved.quickTunnelEndpointPattern, 'ig') }),
      },
      restartOnUnexpectedExit: true,
      onStatus: onQuickStatus,
    })
    quick.start(local)
    retainQuickTunnel(quick)
  }
  ctx.effect(() => {
    void gateway.listen().then(port => {
      const host = resolved.gatewayBind === '::1' ? '[::1]' : resolved.gatewayBind
      const local = 'http://' + host + ':' + port
      ctx.logger.info('dsh-mobile-pairing: bounded Host Gateway on ' + local)
      localGateway = local
      if (live.mode !== 'quick') {
        void retainQuickTunnel()?.stop()
        retainQuickTunnel(null)
        return
      }
      const retained = retainQuickTunnel()
      if (retained !== null && retained.alive() && retained.localGateway() === local) {
        quick = retained
        retained.reattach(onQuickStatus)
        const existing = retained.endpoint()
        if (existing !== null) endpoint = { url: existing, kind: 'temporary' }
        ctx.logger.info('dsh-mobile-pairing: Quick Tunnel reused ' + (existing ?? local))
        return
      }
      void retained?.stop()
      startQuickTunnel(local)
    }, error => ctx.logger.error(error instanceof Error ? error : new Error(String(error))))
    return () => { quick?.detach(); return gateway.close() }
  })
  async function handleEndpointSave(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') return methodNotAllowed(res)
    const body = await readJsonBody(req, res)
    if (body === null) return
    const selection = parseEndpointSelection(body)
    if ('error' in selection) { json(res, 400, { ok: false, stage: 'endpoint', error: selection.error }); return }
    const applied = await applyPublicEndpointSelection(selection, { hostIdentity: keypair.publicKeyBase64Url, adapters: createNodeCustomEndpointAdapters() })
    if (!applied.ok) { json(res, 422, applied); return }
    savePublicEndpointOverlay(overlayPath, selection)
    live.mode = selection.endpointMode
    live.customUrl = selection.customEndpointUrl
    if (applied.endpointMode === 'custom') {
      await quick?.stop()
      quick = null
      retainQuickTunnel(null)
      endpoint = applied.endpoint
    } else if (localGateway !== null) {
      endpoint = null
      if (quick === null || !quick.alive()) {
        void retainQuickTunnel()?.stop()
        startQuickTunnel(localGateway)
      }
    }
    json(res, 200, { ok: true, endpoint, endpointMode: live.mode, customEndpointUrl: live.customUrl ?? null, ...(applied.endpointMode === 'custom' ? { check: applied.check } : {}) })
  }
  ctx.effect(() => webServer.register({ kind: 'exact', path: '/pair/ui', handler: (req, res) => { if (req.method !== 'GET') return methodNotAllowed(res); res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(renderPairingSettingsPage({ hostIdentity: keypair.publicKeyBase64Url, endpoint, endpointMode: live.mode, customEndpointUrl: live.customUrl })) } }))
  ctx.effect(() => webServer.register({ kind: 'exact', path: '/pair/status', handler: (req, res) => { if (req.method !== 'GET') return methodNotAllowed(res); json(res, 200, { endpoint, endpointMode: live.mode, customEndpointUrl: live.customUrl ?? null, hostIdentity: keypair.publicKeyBase64Url, configuration: { file: 'cordis.patch.yml', entryId: 'dsh-mobile-pairing', customEndpointField: 'customEndpointUrl', legacyRelayConfigured: resolved.signalingUrl !== undefined } }) } }))
  ctx.effect(() => webServer.register({ kind: 'exact', path: '/pair/endpoint', handler: (req, res) => { void handleEndpointSave(req, res) } }))
  ctx.effect(() => webServer.register({ kind: 'exact', path: '/pair', handler: (req, res) => handleLocalPair(req, res, endpoint, keypair.publicKeyBase64Url, resolved.appUrl, resolved.stunUrls, offers, store, gateway) }))
  ctx.effect(() => webServer.register({ kind: 'exact', path: '/pair/devices', handler: (req, res) => { if (req.method !== 'GET') return methodNotAllowed(res); json(res, 200, { devices: store.list() }) } }))
  ctx.effect(() => webServer.register({ kind: 'exact', path: '/pair/revoke', handler: async (req, res) => { if (req.method !== 'POST') return methodNotAllowed(res); const body = await readJsonBody(req, res); if (body === null) return; const id = (body as Record<string, unknown>).id; const revoked = typeof id === 'string' && store.revoke(id); json(res, revoked ? 200 : 404, { ok: revoked }) } }))
  ctx.effect(() => webServer.register({ kind: 'exact', path: '/pair/label', handler: async (req, res) => { if (req.method !== 'POST') return methodNotAllowed(res); const body = await readJsonBody(req, res); if (body === null) return; const record = body as Record<string, unknown>; const renamed = typeof record.id === 'string' && typeof record.label === 'string' && store.rename(record.id, record.label); json(res, renamed ? 200 : 404, { ok: renamed }) } }))
}
async function handleLocalPair(req: IncomingMessage, res: ServerResponse, endpoint: GatewayEndpoint | null, pubkey: string, appUrl: string, stunUrls: string[], offers: PairingOfferManager, store: Pick<DeviceTokenStore, 'hasLiveForRoom'>, gateway: { authorizeRoom(room: string, expiresAtMs?: number): void }): Promise<void> {
  if (req.method !== 'GET') return methodNotAllowed(res)
  if (endpoint === null) { json(res, 503, { error: 'Public Endpoint is not ready' }); return }
  const params = new URL(req.url ?? '/', 'http://loopback').searchParams
  const requestedRoom = params.get('room')
  if (requestedRoom !== null && !store.hasLiveForRoom(requestedRoom)) { json(res, 404, { error: 'unknown authorized device room' }); return }
  const room = requestedRoom ?? randomBytes(16).toString('hex')
  const offer = offers.mintPublic({ endpoint: endpoint.url, endpointKind: endpoint.kind, room, pubkey, ice: stunUrls })
  gateway.authorizeRoom(room, offer.exp * 1000)
  const nativeOfferUrl = buildOfferUrl(appUrl, offer)
  const offerUrl = nativeOfferUrl
  if (params.get('format') === 'svg') {
    const compactUrl = buildCompactPublicOfferUrl(appUrl, offer)
    const svg = await renderPairingQrSvg(compactUrl)
    res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' }); res.end(svg); return
  }
  json(res, 200, { ...offer, offerUrl, nativeOfferUrl })
}
const RETAINED_QUICK = Symbol.for('dsh-mobile.quick-tunnel')
function retainQuickTunnel(controller?: QuickTunnelController | null): QuickTunnelController | null {
  const holder = globalThis as typeof globalThis & { [RETAINED_QUICK]?: QuickTunnelController }
  if (controller === null) { delete holder[RETAINED_QUICK]; return null }
  if (controller !== undefined) holder[RETAINED_QUICK] = controller
  return holder[RETAINED_QUICK] ?? null
}
function methodNotAllowed(res: ServerResponse): void { res.writeHead(405); res.end() }
function json(res: ServerResponse, status: number, body: unknown): void { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)) }
async function readJsonBody(req: IncomingMessage, res: ServerResponse): Promise<unknown | null> { const chunks: Buffer[] = []; let size = 0; for await (const chunk of req) { size += (chunk as Buffer).length; if (size > 64 * 1024) { res.writeHead(413); res.end(); return null }; chunks.push(chunk as Buffer) }; try { return JSON.parse(Buffer.concat(chunks).toString()) } catch { json(res, 400, { error: 'invalid JSON body' }); return null } }

