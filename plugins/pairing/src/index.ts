/**
 * @dsh-mobile/pairing — host-half pairing plugin of the dsh-mobile project
 * (out-of-tree; upstream core untouched). Provides: the persistent daemon
 * Curve25519 keypair, the loopback-only /pair route family (offer payload,
 * QR SVG, one-time-code exchange, device list/revoke), and the LAN auth
 * reverse proxy in front of the loopback dsh web server.
 *
 * The upstream web server stays bound to 127.0.0.1; this plugin's proxy is
 * the only LAN-side door, and it rewrites Host to the loopback authority so
 * the upstream /api trust fence classifies forwarded traffic as loopback.
 * The /pair routes themselves live on the loopback server, where the fence
 * already guarantees only this machine's desktop GUI can reach them.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { networkInterfaces } from 'node:os'
import QRCode from 'qrcode'
import { Config, resolveConfig } from './config.ts'
import type { ResolvedConfig } from './config.ts'
import { loadOrCreateKeypair } from './keys.ts'
import { DeviceTokenStore } from './tokens.ts'
import { PairingOfferManager, buildOfferUrl } from './pairing.ts'
import type { PairingOfferPayload } from './pairing.ts'
import { createAuthProxy } from './proxy.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'dsh-mobile-pairing'

/** The only upstream service this half consumes. */
export const inject = ['webServer']

/**
 * The webServer service surface this plugin consumes. Typed locally because
 * the published dsh-host-webserver@0.0.1-rc.1 types lag the repo (they still
 * declare the service under its old httpServer name); replace with a type-only
 * package import once the published types catch up.
 */
interface PairingWebServer {
  register(route: WebRoute): () => void
}

export { Config, resolveConfig } from './config.ts'
export { loadOrCreateKeypair } from './keys.ts'
export type { DaemonKeypair } from './keys.ts'
export { DeviceTokenStore } from './tokens.ts'
export type { DeviceRecord } from './tokens.ts'
export { PairingOfferManager, buildOfferUrl, parseOfferUrl } from './pairing.ts'
export type { PairingOfferPayload } from './pairing.ts'
export { createAuthProxy, WS_AUTH_PREFIX } from './proxy.ts'
export type { AuthProxy, AuthProxyOptions } from './proxy.ts'

/**
 * Plugin body: wire the keypair, stores, /pair routes, and the LAN proxy.
 * @param ctx - plugin context (webServer injected).
 * @param config - schema-parsed config; resolveConfig runs the derive step.
 */
export function apply(ctx: Context, config: Config): void {
  // Declared injection (see inject): the loader guarantees webServer before apply.
  const webServer = (ctx as unknown as { webServer: PairingWebServer }).webServer
  const resolved = resolveConfig(config)
  const keypair = loadOrCreateKeypair(resolved.keyStorePath)
  const store = new DeviceTokenStore(resolved.tokenStorePath)
  const offers = new PairingOfferManager(resolved.codeTtlMs)
  const proxy = createAuthProxy({
    bind: resolved.bind,
    port: resolved.port,
    upstreamHost: resolved.dshHost,
    upstreamPort: resolved.dshPort,
    tokenStore: store,
  })

  ctx.effect(() => {
    proxy.listen().then(
      (port) =>
        ctx.logger.info(
          `dsh-mobile-pairing: auth proxy on ${resolved.bind}:${port} → ${resolved.dshHost}:${resolved.dshPort} (LAN exposure is token-gated)`,
        ),
      (error: unknown) => ctx.logger.error(error instanceof Error ? error : new Error(String(error))),
    )
    return () => proxy.close()
  })

  ctx.effect(() =>
    webServer.register({
      kind: 'exact',
      path: '/pair',
      handler: (req, res) => handlePair(req, res, resolved, proxy.port(), keypair.publicKeyBase64Url, offers),
    }),
  )

  ctx.effect(() =>
    webServer.register({
      kind: 'exact',
      path: '/pair/exchange',
      handler: (req, res) => handleExchange(req, res, offers, store),
    }),
  )

  ctx.effect(() =>
    webServer.register({
      kind: 'exact',
      path: '/pair/devices',
      handler: (req, res) => {
        if (req.method !== 'GET') {
          res.writeHead(405)
          res.end()
          return
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ devices: store.list() }))
      },
    }),
  )

  ctx.effect(() =>
    webServer.register({
      kind: 'exact',
      path: '/pair/revoke',
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          res.writeHead(405)
          res.end()
          return
        }
        const body = await readJsonBody(req, res)
        if (body === null) return
        const id = (body as { id?: unknown }).id
        const revoked = typeof id === 'string' && store.revoke(id)
        res.writeHead(revoked ? 200 : 404, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: revoked }))
      },
    }),
  )
}

/** Mint the current offer and answer JSON, or SVG with ?format=svg. */
async function handlePair(
  req: IncomingMessage,
  res: ServerResponse,
  config: ResolvedConfig,
  proxyPort: number | null,
  pubkey: string,
  offers: PairingOfferManager,
): Promise<void> {
  if (req.method !== 'GET') {
    res.writeHead(405)
    res.end()
    return
  }
  if (proxyPort === null) {
    res.writeHead(503, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'auth proxy is not listening yet' }))
    return
  }
  const addr = config.advertiseUrl ?? lanAdvertiseUrl(proxyPort)
  if (addr === null) {
    res.writeHead(503, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'no LAN address derivable; set advertiseUrl in the plugin config' }))
    return
  }
  const offer = offers.mint('lan', addr, null, pubkey)
  const offerUrl = buildOfferUrl(config.appUrl, offer)
  if (new URL(req.url ?? '/', 'http://x').searchParams.get('format') === 'svg') {
    const svg = await QRCode.toString(offerUrl, { type: 'svg', margin: 1 })
    res.writeHead(200, { 'content-type': 'image/svg+xml' })
    res.end(svg)
    return
  }
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ ...offer, offerUrl }))
}

/** Exchange a one-time code for a device token; the code burns either way. */
async function handleExchange(
  req: IncomingMessage,
  res: ServerResponse,
  offers: PairingOfferManager,
  store: DeviceTokenStore,
): Promise<void> {
  if (req.method !== 'POST') {
    res.writeHead(405)
    res.end()
    return
  }
  const body = await readJsonBody(req, res)
  if (body === null) return
  const { code, label } = body as { code?: unknown; label?: unknown }
  if (typeof code !== 'string' || !offers.exchange(code)) {
    res.writeHead(401, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'invalid or expired pairing code' }))
    return
  }
  const issued = store.issue(typeof label === 'string' ? label : undefined)
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ deviceId: issued.id, deviceToken: issued.token }))
}

/**
 * Read a JSON request body with a hard 64 KiB cap.
 * @returns the parsed value, or null after answering 400/413.
 */
async function readJsonBody(req: IncomingMessage, res: ServerResponse): Promise<unknown | null> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > 64 * 1024) {
      res.writeHead(413)
      res.end()
      return null
    }
    chunks.push(chunk as Buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString())
  } catch {
    res.writeHead(400, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'invalid JSON body' }))
    return null
  }
}

/**
 * Derive the LAN advertise URL from the first non-internal IPv4 interface.
 * @param port - the listened proxy port.
 * @returns http URL, or null when no LAN interface exists (caller answers 503).
 */
function lanAdvertiseUrl(port: number): string | null {
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) return `http://${ni.address}:${port}`
    }
  }
  return null
}
