/**
 * Plugin config: the schemastery schema validates raw cordis.yml values at load
 * (fail loud), then {@link resolveConfig} owns derivation as an explicit
 * resolve step — no hidden `?? default` inside run paths.
 */
import { join } from 'node:path'
import { homedir } from 'node:os'
import z from '@deepseek-ai/schemastery'

/** Plugin config as parsed from cordis.yml (defaults already applied). */
export interface Config {
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
  /** Relay WSS base URL for relay-mode offers (tunnel-protocol.md §1). */
  relayUrl: string
  /** When true, /pair mints relay-mode (v2) offers and drives the relay connector; false keeps M1 LAN offers. */
  enableRelay: boolean
}

export const Config: z<Config> = z.object({
  appUrl: z.string().default('https://app.noirbright.top/'),
  advertiseUrl: z.string(),
  bind: z.string().default('0.0.0.0'),
  port: z.natural().max(65535).default(0),
  dshHost: z.string().default('127.0.0.1'),
  dshPort: z.natural().max(65535).default(3080),
  dshHome: z.string().default(process.env.DSH_HOME ?? join(homedir(), '.dsh')),
  keyStorePath: z.string(),
  tokenStorePath: z.string(),
  codeTtlMs: z.natural().default(300_000),
  relayUrl: z.string().default('wss://relay.noirbright.top'),
  enableRelay: z.boolean().default(true),
})

/** The config after the resolve step: every derivable field is concrete and checked. */
export interface ResolvedConfig extends Config {
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
  if (config.advertiseUrl !== undefined && !/^(https?|wss?):\/\//.test(config.advertiseUrl)) {
    throw new Error(`dsh-mobile-pairing: advertiseUrl must be an http(s)/ws(s) URL, got "${config.advertiseUrl}"`)
  }
  if (!/^https?:\/\//.test(config.appUrl)) {
    throw new Error(`dsh-mobile-pairing: appUrl must be an http(s) URL, got "${config.appUrl}"`)
  }
  if (!/^wss?:\/\//.test(config.relayUrl)) {
    throw new Error(`dsh-mobile-pairing: relayUrl must be a ws(s) URL, got "${config.relayUrl}"`)
  }
  if (config.codeTtlMs <= 0) {
    throw new Error('dsh-mobile-pairing: codeTtlMs must be positive')
  }
  return {
    ...config,
    keyStorePath: config.keyStorePath ?? join(config.dshHome, 'mobile', 'daemon-keypair.json'),
    tokenStorePath: config.tokenStorePath ?? join(config.dshHome, 'mobile', 'devices.json'),
  }
}
