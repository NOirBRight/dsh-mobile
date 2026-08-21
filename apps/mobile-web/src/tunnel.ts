/**
 * Tunnel integration for the mobile shell: offer bootstrap, connection
 * manager with reconnect, and the fetch/WebSocket shims that route the
 * shell's same-origin traffic through the E2E tunnel (docs/tunnel-protocol.md).
 *
 * Host metadata comes from ProfileRepository; every reconnect acquires a
 * short-lived credential lease from the app-private vault. Pairing fragments
 * and Android credentials never enter Web localStorage.
 */
import { connect, HeartbeatController, TunnelError } from '@dsh-mobile/e2e-tunnel'
import type { ClientKeypair, ConnectionPolicy, ConnectionStatus, ConnectOptions, TunnelClient, TunnelState } from '@dsh-mobile/e2e-tunnel'
import { extractBootManifestJson, localizePluginBundles, officialNarrowContractAvailable, readCachedBootManifest, selectResponsiveBootManifest, createLocalStoragePluginCache, writeCachedBootManifest, type ResponsiveBootSelection, type ResponsiveBootSelectionOptions } from './manifest.ts'

/**
 * Fetch the boot manifest through the tunnel and install it as
 * window.__DSH_BOOT__. The Host Gateway serves packaged assets without
 * injecting the roster, so the shell must read the live DSH index through
 * the authenticated session before AppWebEntry runs.
 */
export async function injectBootManifestFromTunnel(
  client: TunnelClient,
  responsive: ResponsiveBootSelectionOptions & { localizePlugins?: boolean; hostId?: string } = { viewportWidth: window.innerWidth },
): Promise<ResponsiveBootSelection> {
  const res = await client.fetch('/')
  if (!res.ok) throw new Error('boot manifest fetch failed: HTTP ' + res.status)
  const hostManifest = extractBootManifestJson(await res.text(), 'boot manifest not found in tunneled index')
  const selection = selectResponsiveBootManifest(hostManifest, {
    ...responsive,
    narrowContractAvailable: responsive.narrowContractAvailable ?? officialNarrowContractAvailable(hostManifest),
  })
  if (typeof responsive.hostId === 'string') writeCachedBootManifest(responsive.hostId, hostManifest as Parameters<typeof writeCachedBootManifest>[1])
  if (responsive.localizePlugins === false) {
    ;(window as unknown as { __DSH_BOOT__: unknown }).__DSH_BOOT__ = selection.manifest
    return selection
  }
  const localizedManifest = await localizePluginBundles(selection.manifest, {
    load: async (url) => {
      let last = 'failed to load host plugin ' + url
      for (let attempt = 1; attempt <= 3; attempt++) {
        const response = await client.fetch(url)
        if (response.ok) return response.text()
        last = 'failed to load host plugin ' + url + ': HTTP ' + response.status
        if (response.status !== 502 && response.status !== 503) break
        await new Promise(resolve => setTimeout(resolve, 250 * attempt))
      }
      throw new Error(last)
    },
    createUrl: pluginBlobUrl,
    cache: createLocalStoragePluginCache(undefined, responsive.hostId ?? ''),
  })
  ;(window as unknown as { __DSH_BOOT__: unknown }).__DSH_BOOT__ = localizedManifest
  return { ...selection, manifest: localizedManifest }
}

function pluginBlobUrl(source: string, id: string): string {
  return URL.createObjectURL(new Blob([
    source + '\n//# sourceURL=dsh-plugin:' + id,
  ], { type: 'text/javascript' }))
}

/**
 * Rebuild a responsive boot selection from the last cached Host roster without
 * waiting for the tunnel. Returns null when the cache is missing or incomplete.
 */
export async function hydrateBootManifestFromCache(
  hostId: string,
  responsive: ResponsiveBootSelectionOptions & { localizePlugins?: boolean } = { viewportWidth: typeof window === 'undefined' ? 0 : window.innerWidth },
): Promise<ResponsiveBootSelection | null> {
  const cached = readCachedBootManifest(hostId)
  if (cached === undefined) return null
  try {
    const selection = selectResponsiveBootManifest(cached, {
      ...responsive,
      narrowContractAvailable: responsive.narrowContractAvailable ?? officialNarrowContractAvailable(cached),
    })
    if (responsive.localizePlugins === false) {
      ;(window as unknown as { __DSH_BOOT__: unknown }).__DSH_BOOT__ = selection.manifest
      return selection
    }
    const localizedManifest = await localizePluginBundles(selection.manifest, {
      load: async () => { throw new Error('plugin cache miss') },
      createUrl: pluginBlobUrl,
      cache: createLocalStoragePluginCache(undefined, hostId),
      cacheOnly: true,
    })
    ;(window as unknown as { __DSH_BOOT__: unknown }).__DSH_BOOT__ = localizedManifest
    return { ...selection, manifest: localizedManifest }
  } catch {
    return null
  }
}

export interface TunnelCredentialLease {
  clientKeypair: ClientKeypair
  deviceToken?: string
  onDeviceToken(token: string): Promise<void>
  dispose(): void
}

export interface TunnelManagerOptions {
  offerUrl: string
  connectionPolicy: ConnectionPolicy
  loadCredentials(): Promise<TunnelCredentialLease>
  onState(state: TunnelState): void
  onConnectionStatus?: (status: ConnectionStatus) => void
  onError?: (message: string) => void
  connect?: (offerUrl: string, options?: ConnectOptions) => Promise<TunnelClient>
  wait?: (delayMs: number) => Promise<void>
  random?: () => number
  deviceLabel?: string
  clientType?: 'android' | 'browser'
  /** Wait for armHeartbeat() after Host UI boot; default starts probing immediately. */
  deferHeartbeat?: boolean
}

const TERMINAL_CONNECTION_ERRORS = new Set([
  'bad-token', 'bad-code', 'expired', 'bad-offer', 'bad-key', 'unauthorized', 'identity-mismatch', 'incompatible', 'no-route', 'limit',
])

/** Own one Active Host session, heartbeat it, and reconnect transport failures with jitter. */
export class TunnelManager {
  private client: TunnelClient | null = null
  private heartbeat: HeartbeatController | null = null
  private waiters: Array<{ resolve: (client: TunnelClient) => void; reject: (error: Error) => void }> = []
  private closeWaiter: (() => void) | null = null
  private stopped = false
  private started = false
  private terminalError: Error | null = null
  private lastRoute: 'direct' | 'tunnel' | null = null
  private preferTunnelOnce = false
  private heartbeatArmed = false
  private readonly options: TunnelManagerOptions

  constructor(options: TunnelManagerOptions) { this.options = options }

  start(): void {
    if (this.started) return
    this.started = true
    void this.loop()
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    this.heartbeat?.stop()
    this.heartbeat = null
    this.client?.close()
    this.client = null
    this.closeWaiter?.()
    this.closeWaiter = null
    const stopped = new TunnelError('closed', 'Active Host connection stopped')
    for (const waiter of this.waiters.splice(0)) waiter.reject(stopped)
  }

  async probeNow(): Promise<void> {
    if (this.options.deferHeartbeat === true && !this.heartbeatArmed) return
    await this.heartbeat?.probeNow()
  }

  /** Start liveness probes after Host UI boot has finished using the session. */
  armHeartbeat(): void {
    this.heartbeatArmed = true
    this.heartbeat?.start()
  }

  private setState(state: TunnelState): void {
    this.options.onState(state)
    if (state === 'closed') this.closeWaiter?.()
  }

  private async loop(): Promise<void> {
    let backoff = 1000
    const connector = this.options.connect ?? connect
    const wait = this.options.wait ?? ((delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs)))
    const random = this.options.random ?? Math.random
    while (!this.stopped) {
      let lease: TunnelCredentialLease | null = null
      try {
        lease = await this.options.loadCredentials()
        if (this.stopped) { lease.dispose(); return }
        const policy = this.preferTunnelOnce && this.options.connectionPolicy === 'automatic' ? 'tunnel-only' : this.options.connectionPolicy
        this.preferTunnelOnce = false
        const client = await connector(this.options.offerUrl, {
          clientKeypair: lease.clientKeypair, deviceToken: lease.deviceToken, onDeviceToken: lease.onDeviceToken,
          connectionPolicy: policy, onConnectionStatus: status => {
            if (status.route === 'direct' || status.route === 'tunnel') this.lastRoute = status.route
            this.options.onConnectionStatus?.(status)
          },
          deviceLabel: this.options.deviceLabel, clientType: this.options.clientType,
          onStateChange: state => this.setState(state),
        })
        if (this.stopped) {
          lease.dispose()
          client.close()
          return
        }
        lease.dispose(); lease = null
        this.client = client
        backoff = 1000
        this.heartbeat = new HeartbeatController({
          target: client,
          onStale: error => { this.options.onError?.(error.code + ': ' + error.message); client.close() },
        })
        if (this.options.deferHeartbeat !== true || this.heartbeatArmed) this.heartbeat.start()
        for (const waiter of this.waiters.splice(0)) waiter.resolve(client)
        await new Promise<void>(resolve => { this.closeWaiter = resolve })
        this.closeWaiter = null
        this.heartbeat.stop(); this.heartbeat = null
        this.client = null
        if (this.lastRoute === 'direct' && this.options.connectionPolicy === 'automatic') this.preferTunnelOnce = true
      } catch (error) {
        lease?.dispose()
        const failure = error instanceof Error ? error : new Error(String(error))
        const code = error instanceof TunnelError ? error.code : null
        this.setState('connecting')
        this.options.onError?.(code === null ? failure.message : code + ': ' + failure.message)
        if (code !== null && TERMINAL_CONNECTION_ERRORS.has(code)) {
          this.terminalError = failure
          for (const waiter of this.waiters.splice(0)) waiter.reject(failure)
          return
        }
      }
      if (this.stopped) return
      this.setState('connecting')
      await wait(Math.round(backoff * (0.8 + random() * 0.4)))
      backoff = Math.min(backoff * 2, 10_000)
    }
  }

  /** The open client; waits out connectivity retries but rejects terminal Host verdicts. */
  current(): Promise<TunnelClient> {
    if (this.client !== null && this.client.state === 'open') return Promise.resolve(this.client)
    if (this.terminalError !== null) return Promise.reject(this.terminalError)
    if (this.stopped) return Promise.reject(new TunnelError('closed', 'Active Host connection stopped'))
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }))
  }
}

type Handler = (ev: never) => void

/**
 * WebSocket facade that defers to client.openWebSocket once the tunnel is
 * open (the shell opens its downlinks during boot, usually before the tunnel
 * campaign lands). send() is queued until open; cross-origin URLs bypass the
 * tunnel entirely and construct a native socket.
 */
export class DeferredWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  readonly CONNECTING = 0
  readonly OPEN = 1
  readonly CLOSING = 2
  readonly CLOSED = 3

  onopen: Handler | null = null
  onmessage: Handler | null = null
  onerror: Handler | null = null
  onclose: Handler | null = null
  /** Interface parity; the tunnel always delivers strings. */
  binaryType: string = 'arraybuffer'

  private inner: { readyState: number; send(data: unknown): void; close(code?: number, reason?: string): void; addEventListener(type: string, cb: Handler): void } | null = null
  private queue: unknown[] = []
  private listeners = new Map<string, Handler[]>()
  private forced: number | null = null

  constructor(mgr: TunnelClientSource, NativeWS: typeof WebSocket, url: string | URL, protocols?: string | string[]) {
    const u = new URL(String(url), location.origin)
    // Compare by HOST, not origin: the shell builds downlinks as ws(s)://<host>/api/...,
    // and wss://x != https://x as origins even for the same server.
    // Gateway /signal and /tunnel are also same-origin on the browser shell; they
    // must use the native socket or connect() deadlocks on its own shim.
    if (u.host !== location.host || isHostGatewaySocketPath(u.pathname)) {
      this.bind(new NativeWS(String(url), protocols) as never)
      return
    }
    void mgr.current().then((client) => {
      if (this.forced === 3) return
      this.bind(client.openWebSocket(u.pathname + u.search) as never)
    }, () => { this.fail() })
  }

  private fail(): void {
    if (this.forced === 3) return
    this.forced = 3
    this.queue.length = 0
    this.emit('error', { type: 'error' })
    this.emit('close', { type: 'close', code: 1011, reason: 'tunnel unavailable' })
  }

  private bind(sock: NonNullable<DeferredWebSocket['inner']>): void {
    this.inner = sock
    for (const type of ['open', 'message', 'error', 'close'] as const) {
      sock.addEventListener(type, ((ev: unknown) => {
        if (type === 'open') {
          for (const data of this.queue.splice(0)) sock.send(data)
        }
        this.emit(type, ev)
      }) as never)
    }
  }

  get readyState(): number {
    if (this.forced !== null) return this.forced
    return this.inner ? this.inner.readyState : 0
  }

  send(data: unknown): void {
    if (this.readyState === 1 && this.inner) this.inner.send(data)
    else if (this.readyState === 0) this.queue.push(data)
  }

  close(code?: number, reason?: string): void {
    if (this.forced === 3) return
    this.forced = 3
    this.inner?.close(code, reason)
  }

  addEventListener(type: string, cb: Handler): void {
    const list = this.listeners.get(type) ?? []
    list.push(cb)
    this.listeners.set(type, list)
  }

  removeEventListener(type: string, cb: Handler): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((x) => x !== cb))
  }

  private emit(type: string, ev: unknown): void {
    const prop = (this as Record<string, unknown>)['on' + type] as Handler | null
    prop?.call(this, ev as never)
    for (const cb of this.listeners.get(type) ?? []) cb.call(this, ev as never)
  }
}

/** Packaged Android shell assets that must not be fetched from the Host. */
export function isPackagedShellPluginPath(pathname: string): boolean {
  return pathname === '/plugins/@dsh-mobile/ui-layout-mobile/client.js'
    || pathname.startsWith('/plugins/@dsh-mobile/ui-layout-mobile/')
}

/** Host Gateway rendezvous/tunnel sockets stay on the Public Endpoint, not the tunneled Host. */
export function isHostGatewaySocketPath(pathname: string): boolean {
  return pathname === '/signal/check' || pathname.startsWith('/signal/') || pathname.startsWith('/tunnel/')
}

/** Host plugin bundles travel as tunneled application frames, except the packaged mobile layout. */
export function isPublicEndpointPluginPath(pathname: string): boolean {
  return pathname.startsWith('/plugins/') && !isPackagedShellPluginPath(pathname)
}

/** Swap the live TunnelManager without reinstalling fetch/WebSocket shims. */
export interface TunnelClientSource {
  current(): Promise<TunnelClient>
}

export class TunnelManagerSlot implements TunnelClientSource {
  private source: TunnelClientSource | null = null
  attach(source: TunnelClientSource): void { this.source = source }
  current(): Promise<TunnelClient> {
    if (this.source === null) return Promise.reject(new TunnelError('closed', 'Active Host connection is not started'))
    return this.source.current()
  }
}

/** Bare Host bridge already owns same-origin API/WebSocket; every other shell needs tunnel shims. */
export function shouldInstallTunnelShims(sameOriginHostBridge: boolean): boolean {
  return !sameOriginHostBridge
}

/** Route the shell's same-origin fetch/WebSocket traffic through the tunnel. */
export function installShims(mgr: TunnelClientSource): void {
  const nativeFetch = window.fetch.bind(window)
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const u = new URL(raw, location.origin)
    if (u.origin !== location.origin) return nativeFetch(input, init)
    if (isPackagedShellPluginPath(u.pathname) || isHostGatewaySocketPath(u.pathname)) return nativeFetch(input, init)
    const client = await mgr.current()
    return client.fetch(u.pathname + u.search, init as never)
  }) as typeof fetch

  const NativeWS = window.WebSocket
  window.WebSocket = class extends DeferredWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(mgr, NativeWS, url, protocols)
    }
  } as never
}

/** Bottom-right tunnel state dot (green open / yellow connecting / red closed). */
export function installBadge(onActivate?: () => void): (state: TunnelState, route?: string) => void {
  const el = document.createElement('button')
  el.style.cssText =
    'position:fixed;right:12px;bottom:calc(12px + env(safe-area-inset-bottom));min-height:24px;padding:3px 8px;' +
    'display:flex;align-items:center;border-radius:999px;z-index:9999;transition:background .3s;color:white;' +
    'font:600 11px/1.2 system-ui,sans-serif;box-shadow:0 1px 4px rgba(0,0,0,.28)'
  el.type = 'button'
  el.setAttribute('aria-label', 'Connection route and Host Profiles')
  if (onActivate !== undefined) el.addEventListener('click', onActivate)
  document.body.appendChild(el)
  const titles: Record<TunnelState, string> = { open: '隧道已连接', connecting: '隧道连接中…', closed: '隧道已断开,重连中' }
  return (state, route = '') => {
    el.style.background = state === 'open' ? '#22c55e' : state === 'connecting' ? '#eab308' : '#ef4444'
    el.title = route === '' ? titles[state] : route + ' · ' + titles[state]
    el.textContent = route === '' ? titles[state] : route
  }
}
