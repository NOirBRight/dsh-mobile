/**
 * Plugin config: the schemastery schema validates raw cordis.yml values at load
 * (fail loud), then {@link resolveConfig} owns derivation as an explicit
 * resolve step — no hidden `?? default` inside run paths.
 */
import { join } from 'node:path'
import { homedir, hostname } from 'node:os'
import z from '@deepseek-ai/schemastery'

/** Plugin config as parsed from cordis.yml (defaults already applied). */
export interface Config {
  /** Optional user-facing Host name; absent falls back to the DSH port plus system hostname. */
  hostName?: string
  /** Base URL the QR points the phone at (the mobile shell PWA, M2+). */
  appUrl: string
  /** Advertised `addr` override; unset derives http://<first LAN IPv4>:<proxy port> per request. */
  advertiseUrl?: string
  /** Auth-proxy bind host. */
  bind: string
  /** Auth-proxy bind port; 0 asks the OS, the listened value is logged at startup. */
  port: number
  /** Upstream dsh web host. The proxy only ever forwards to loopback. */
  dshHost: string
  /** Upstream dsh web port. */
  dshPort: number
  /** Harness home; the keypair and device store live under it unless overridden. */
  dshHome: string
  /** Daemon Curve25519 keypair file; unset derives <dshHome>/mobile/daemon-keypair.json. */
  keyStorePath?: string
  /** Device token store file; unset derives <dshHome>/mobile/devices.json. */
  tokenStorePath?: string
  /** One-time pairing-code lifetime in milliseconds. */
  codeTtlMs: number
  /** Product Public Endpoint mode. Quick Tunnel is the zero-configuration default. */
  endpointMode: 'quick' | 'custom' | 'relay'
  /** Operator-provisioned URL, required only in custom mode. */
  customEndpointUrl?: string
  /** Official or self-hosted opaque sealed-frame Relay WSS base. */
  relayUrl?: string
  /** Standalone Host Gateway is always loopback-bound. */
  gatewayBind: '127.0.0.1' | '::1' | 'localhost'
  /** Standalone Host Gateway listen port; 0 asks the OS. */
  gatewayPort: number
  /** Optional Quick Tunnel executable; defaults to cloudflaredPath. */
  quickTunnelCommand?: string
  /** Optional argv template; `{gateway}` is replaced with the loopback Gateway URL. */
  quickTunnelArgs?: string[]
  /** Optional regex source that extracts the HTTPS endpoint from Quick Tunnel logs. */
  quickTunnelEndpointPattern?: string
  /** cloudflared executable used in quick mode. */
  cloudflaredPath: string
  /** Legacy outbound signaling URL; never a product default. */
  signalingUrl?: string
  /** Public STUN discovery URLs. TURN/TURNS are rejected. */
  stunUrls: string[]
  /** Legacy flag retained for config compatibility; product /pair mints v4 Public Endpoint offers. */
  enableDirect: boolean
}

export const Config: z<Config> = z.object({
  hostName: z.string(),
  appUrl: z.string().default('dsh-mobile://pair'),
  advertiseUrl: z.string(),
  bind: z.string().default('0.0.0.0'),
  port: z.natural().max(65535).default(0),
  dshHost: z.string().default('127.0.0.1'),
  dshPort: z.natural().max(65535).default(3080),
  dshHome: z.string().default(process.env.DSH_HOME ?? join(homedir(), '.dsh')),
  keyStorePath: z.string(),
  tokenStorePath: z.string(),
  codeTtlMs: z.natural().default(300_000),
  endpointMode: z.string().default('quick') as z<'quick' | 'custom' | 'relay'>,
  customEndpointUrl: z.string(),
  relayUrl: z.string(),
  gatewayBind: z.string().default('127.0.0.1') as z<'127.0.0.1' | '::1' | 'localhost'>,
  gatewayPort: z.natural().max(65535).default(0),
  cloudflaredPath: z.string().default('cloudflared'),
  quickTunnelCommand: z.string(),
  quickTunnelArgs: z.array(z.string()).default(['tunnel', '--url', '{gateway}', '--no-autoupdate']),
  quickTunnelEndpointPattern: z.string(),
  signalingUrl: z.string(),
  stunUrls: z.array(z.string()).default(['stun:stun.cloudflare.com:3478']),
  enableDirect: z.boolean().default(true),
})

/** The config after the resolve step: every derivable field is concrete and checked. */
export interface ResolvedConfig extends Config {
  hostName: string
  keyStorePath: string
  tokenStorePath: string
}

/**
 * Derive the remaining defaults and enforce the checks the schema cannot
 * express. Throws on any invalid value — misconfiguration fails loud at load.
 * @param config - schema-parsed config.
 * @returns config with every field concrete.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  // DSH does not currently expose its user-chosen profile name to plugins. An
  // explicit hostName therefore wins; otherwise keep instances on the same
  // machine distinguishable by putting the configured upstream port first.
  const fallbackHostName = `${config.dshPort} · ${hostname()}`
  const hostName = (config.hostName ?? fallbackHostName).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 64)
  if (hostName === '') throw new Error('dsh-mobile-pairing: hostName must not be empty')
  if (config.advertiseUrl !== undefined && !/^(https?|wss?):\/\//.test(config.advertiseUrl)) {
    throw new Error(`dsh-mobile-pairing: advertiseUrl must be an http(s)/ws(s) URL, got "${config.advertiseUrl}"`)
  }
  if (!/^(https?:\/\/|dsh-mobile:\/\/pair(?:$|[?#]))/.test(config.appUrl)) {
    throw new Error(`dsh-mobile-pairing: appUrl must be an http(s) URL or dsh-mobile://pair, got "${config.appUrl}"`)
  }
  if (config.endpointMode !== 'quick' && config.endpointMode !== 'custom' && config.endpointMode !== 'relay') throw new Error('dsh-mobile-pairing: endpointMode must be quick, custom, or relay')
  if (!['127.0.0.1', '::1', 'localhost'].includes(config.gatewayBind)) throw new Error('dsh-mobile-pairing: gatewayBind must be loopback')
  if (config.endpointMode === 'custom') {
    if (config.customEndpointUrl === undefined) throw new Error('dsh-mobile-pairing: customEndpointUrl is required in custom mode')
    let endpoint: URL
    try { endpoint = new URL(config.customEndpointUrl) } catch { throw new Error('dsh-mobile-pairing: customEndpointUrl must be HTTPS') }
    if (endpoint.protocol !== 'https:') throw new Error('dsh-mobile-pairing: customEndpointUrl must be HTTPS')
    if (endpoint.username !== '' || endpoint.password !== '') throw new Error('dsh-mobile-pairing: customEndpointUrl must not contain credentials')
  }
  if (config.endpointMode === 'relay') {
    if (config.relayUrl === undefined) throw new Error('dsh-mobile-pairing: relayUrl is required in relay mode')
    let relay: URL
    try { relay = new URL(config.relayUrl) } catch { throw new Error('dsh-mobile-pairing: relayUrl must be WSS') }
    if (relay.protocol !== 'wss:') throw new Error('dsh-mobile-pairing: relayUrl must be WSS')
    if (relay.username !== '' || relay.password !== '' || relay.search !== '' || relay.hash !== '') throw new Error('dsh-mobile-pairing: relayUrl must not contain credentials, query, or fragment data')
  }
  if (config.signalingUrl !== undefined && !/^wss?:\/\//.test(config.signalingUrl)) {
    throw new Error(`dsh-mobile-pairing: signalingUrl must be a ws(s) URL, got "${config.signalingUrl}"`)
  }
  if (config.dshHost !== '127.0.0.1' && config.dshHost !== '::1' && config.dshHost !== 'localhost') {
    throw new Error('dsh-mobile-pairing: dshHost must be loopback')
  }
  if (config.stunUrls.some(url => !/^stuns?:(\/\/)?/i.test(url))) {
    throw new Error('dsh-mobile-pairing: stunUrls must contain STUN-only URLs; TURN is never accepted')
  }
  if (config.codeTtlMs <= 0) {
    throw new Error('dsh-mobile-pairing: codeTtlMs must be positive')
  }
  if (config.quickTunnelEndpointPattern !== undefined) {
    try { void new RegExp(config.quickTunnelEndpointPattern, 'ig') } catch {
      throw new Error('dsh-mobile-pairing: quickTunnelEndpointPattern must be a valid regular expression')
    }
  }
  return {
    ...config,
    hostName,
    keyStorePath: config.keyStorePath ?? join(config.dshHome, 'mobile', 'daemon-keypair.json'),
    tokenStorePath: config.tokenStorePath ?? join(config.dshHome, 'mobile', 'devices.json'),
  }
}
