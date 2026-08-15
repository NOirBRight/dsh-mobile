/**
 * @dsh-mobile/bundle-mobile-web — the mobile browser-surface bundle: the
 * cordis.patch.yml layer plus this runtime glue plugin.
 *
 * The upstream web-runtime glue (dsh-web-app) resolves the served dist
 * through @deepseek-ai/dsh-web-frontend's exports with no config override,
 * so the mobile surface cannot reuse it; the patch disables that row and
 * seats this plugin to provide the one service downstream rows consume:
 * webRuntime (LAN trust sampling for the /api browser-trust fence,
 * mirrored from the upstream resolveLanTrust). Dist serving is a separate
 * frontend-static row in the patch, not this plugin's job.
 *
 * Deliberately zero @deepseek-ai runtime imports: this package is resolved
 * from its own repository when mounted out-of-tree, so every upstream value
 * import would be an unresolvable hazard. Type-only imports erase.
 * @module @dsh-mobile/bundle-mobile-web
 */

import { networkInterfaces } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'

/** Stable Cordis plugin name. */
export const name = 'mobile-web-runtime'

/** Service required before LAN trust can be sampled. */
export const inject = ['webServer']

/** Plugin config: composed deployment settings plus per-invocation command-line values. */
export interface Config {
  /** Print the URL line on activation. */
  printUrl: boolean
  /** Explicit --trusted-host authorities from this invocation. */
  trustedHosts: string[]
}

/**
 * Hand-rolled config validation, failing loud at load. This bundle carries no
 * schemastery dependency: the vendored rescope packages are not reliably
 * published, and an out-of-tree bundle resolves imports from its own repo.
 * @param raw - the row's config value.
 * @returns the validated config.
 */
function validateConfig(raw: unknown): Config {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('mobile-web-runtime: config must be an object')
  }
  const c = raw as Record<string, unknown>
  if (typeof c.printUrl !== 'boolean') {
    throw new Error('mobile-web-runtime: config.printUrl must be a boolean')
  }
  if (!Array.isArray(c.trustedHosts) || !c.trustedHosts.every((h) => typeof h === 'string')) {
    throw new Error('mobile-web-runtime: config.trustedHosts must be a string array')
  }
  return { printUrl: c.printUrl, trustedHosts: c.trustedHosts }
}

/** The webserver schema's all-interfaces bind literal. */
const ALL_INTERFACES_HOST = '0.0.0.0'
/** Display-only loopback literal for the URL line (the webserver schema owns the bind). */
const LOOPBACK_HOST = '127.0.0.1'

/**
 * Mount the mobile Web runtime: sample LAN trust once, provide webRuntime,
 * print the URL line. Mirrors dsh-web-app's resolveLanTrust: LAN literals
 * derive only from an all-interfaces bind and stay port-less (a rebound
 * attacker needs a name, not an IP literal; the OS-assigned port is
 * unknowable before bind).
 * @param ctx - plugin context carrying the webServer service.
 * @param rawConfig - the row's config value, validated here.
 */
export function apply(ctx: Context, rawConfig: unknown): void {
  const config = validateConfig(rawConfig)
  const lanAddresses = ctx.webServer.host === ALL_INTERFACES_HOST
    ? Object.values(networkInterfaces()).flat()
      .filter((iface): iface is NonNullable<typeof iface> => iface !== undefined && iface.family === 'IPv4' && !iface.internal)
      .map((iface) => iface.address)
    : []
  // Release dependent rows (connection's !!js ctx.webRuntime.trustedHosts)
  // only after bind-dependent trust has been sampled once.
  ctx.provide('webRuntime', { lanAddresses, trustedHosts: [...lanAddresses, ...config.trustedHosts] })
  if (config.printUrl) {
    console.log('dsh mobile-web: http://' + LOOPBACK_HOST + ':' + String(ctx.webServer.port))
  }
}
