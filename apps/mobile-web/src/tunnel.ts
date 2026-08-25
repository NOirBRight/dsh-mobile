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
import { createLocalStoragePluginCache, extractBootManifestJson, localizePluginBundles, officialNarrowContractAvailable, PLUGIN_LOAD_CONCURRENCY, readCachedBootManifest, selectResponsiveBootManifest, writeCachedBootManifest, type ResponsiveBootSelection, type ResponsiveBootSelectionOptions } from './manifest.ts'
import { findConnectionBadgeAnchor, findSettingsTrigger, OFFICIAL_DRAWER, OWN_DRAWER_BRAND, OWN_TOPBAR, queryDrawerToggleSlot } from './anchors.ts'
import type { EndpointKind } from './profiles.ts'

export { findConnectionBadgeAnchor } from './anchors.ts'

/** Give up on a silent Cloudflare tunnel instead of spinning on GET / forever. */
export const BOOT_FETCH_TIMEOUT_MS = 20_000

function abortAfter(ms: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return {
    signal: controller.signal,
    cancel() { clearTimeout(timer) },
  }
}

async function fetchThroughTunnel(client: TunnelClient, url: string, timeoutMs: number): Promise<Response> {
  const timeout = abortAfter(timeoutMs)
  try {
    return await new Promise<Response>((resolve, reject) => {
      const onAbort = () => reject(new TunnelError('timeout', 'boot fetch timed out: ' + url))
      timeout.signal.addEventListener('abort', onAbort, { once: true })
      if (timeout.signal.aborted) {
        onAbort()
        return
      }
      client.fetch(url, { signal: timeout.signal }).then(resolve, error => {
        if (timeout.signal.aborted) onAbort()
        else reject(error)
      })
    })
  } finally {
    timeout.cancel()
  }
}

/**
 * Fetch the boot manifest through the tunnel and install it as
 * window.__DSH_BOOT__. The Host Gateway serves packaged assets without
 * injecting the roster, so the shell must read the live DSH index through
 * the authenticated session before AppWebEntry runs.
 */
export async function injectBootManifestFromTunnel(
  client: TunnelClient,
  responsive: ResponsiveBootSelectionOptions & {
    localizePlugins?: boolean
    hostId?: string
    fetchTimeoutMs?: number
    /** In-flight plugin loads; cold pairings need the wide pipe to not read as a hang. */
    pluginConcurrency?: number
    onPluginProgress?: (loaded: number, total: number) => void
  } = { viewportWidth: window.innerWidth },
): Promise<ResponsiveBootSelection> {
  const timeoutMs = responsive.fetchTimeoutMs ?? BOOT_FETCH_TIMEOUT_MS
  const res = await fetchThroughTunnel(client, '/', timeoutMs)
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
        const response = await fetchThroughTunnel(client, url, timeoutMs)
        if (response.ok) return response.text()
        last = 'failed to load host plugin ' + url + ': HTTP ' + response.status
        if (response.status !== 502 && response.status !== 503) break
        await new Promise(resolve => setTimeout(resolve, 250 * attempt))
      }
      throw new Error(last)
    },
    createUrl: pluginBlobUrl,
    cache: createLocalStoragePluginCache(undefined, responsive.hostId ?? ''),
    concurrency: responsive.pluginConcurrency ?? PLUGIN_LOAD_CONCURRENCY,
    ...responsive.onPluginProgress === undefined ? {} : { onProgress: responsive.onPluginProgress },
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
  const cached = readCachedBootManifest(hostId) ?? readCachedBootManifest('last')
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

export type TunnelManagerActivity =
  | { phase: 'connecting'; attempt: number; reconnecting: boolean; route: 'direct' | 'tunnel' | null }
  | { phase: 'retry-wait'; attempt: number; retryInMs: number; route: 'direct' | 'tunnel' | null; error?: string }
  | { phase: 'open'; attempt: number; route: 'direct' | 'tunnel' | null }
  | { phase: 'terminal'; attempt: number; route: 'direct' | 'tunnel' | null; error: string }

export interface TunnelManagerOptions {
  offerUrl: string
  connectionPolicy: ConnectionPolicy
  loadCredentials(): Promise<TunnelCredentialLease>
  onState?(state: TunnelState): void
  onConnectionStatus?: (status: ConnectionStatus) => void
  onActivity?: (activity: TunnelManagerActivity) => void
  onError?: (message: string) => void
  onHostMetadata?: (metadata: { displayName: string }) => void | Promise<void>
  connect?: (offerUrl: string, options?: ConnectOptions) => Promise<TunnelClient>
  wait?: (delayMs: number) => Promise<void>
  random?: () => number
  deviceLabel?: string
  clientType?: 'android' | 'browser'
  /** Wait for armHeartbeat() after Host UI boot; default starts probing immediately. */
  deferHeartbeat?: boolean
  endpointKind?: EndpointKind
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
  private connectWake: (() => void) | null = null
  private retryWake: (() => void) | null = null
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
    this.connectWake?.()
    this.connectWake = null
    this.retryWake?.()
    this.retryWake = null
    const stopped = new TunnelError('closed', 'Active Host connection stopped')
    for (const waiter of this.waiters.splice(0)) waiter.reject(stopped)
  }

  async probeNow(): Promise<void> {
    if (this.heartbeat === null) {
      this.connectWake?.()
      this.retryWake?.()
      return
    }
    if (this.options.deferHeartbeat === true && !this.heartbeatArmed) return
    await this.heartbeat.probeNow()
  }

  /** Start liveness probes after Host UI boot has finished using the session. */
  armHeartbeat(): void {
    this.heartbeatArmed = true
    this.heartbeat?.start()
  }

  private setState(state: TunnelState): void {
    if (this.stopped) return
    this.options.onState?.(state)
    if (state === 'closed') this.closeWaiter?.()
  }

  private async loop(): Promise<void> {
    let backoff = 1000
    let attempt = 0
    let hasConnected = false
    const connector = this.options.connect ?? connect
    const wait = this.options.wait ?? ((delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs)))
    const random = this.options.random ?? Math.random
    while (!this.stopped) {
      attempt += 1
      this.options.onActivity?.({ phase: 'connecting', attempt, reconnecting: hasConnected || attempt > 1, route: this.lastRoute })
      let lease: TunnelCredentialLease | null = null
      let retryError: string | undefined
      try {
        lease = await this.options.loadCredentials()
        if (this.stopped) { lease.dispose(); return }
        const policy = this.preferTunnelOnce && this.options.connectionPolicy === 'automatic' ? 'tunnel-only' : this.options.connectionPolicy
        this.preferTunnelOnce = false
        let acceptAttemptCallbacks = true
        const pendingClient = connector(this.options.offerUrl, {
          clientKeypair: lease.clientKeypair, deviceToken: lease.deviceToken, onDeviceToken: lease.onDeviceToken,
          connectionPolicy: policy, onConnectionStatus: status => {
            if (this.stopped || !acceptAttemptCallbacks) return
            if (status.route === 'direct' || status.route === 'tunnel') this.lastRoute = status.route
            this.options.onConnectionStatus?.(status)
          },
          deviceLabel: this.options.deviceLabel, clientType: this.options.clientType, onHostMetadata: this.options.onHostMetadata,
          onStateChange: state => { if (acceptAttemptCallbacks) this.setState(state) },
        })
        let wakeConnect!: () => void
        const interrupted = new Promise<null>(resolve => { wakeConnect = () => { resolve(null) } })
        this.connectWake = wakeConnect
        let client: TunnelClient | null
        try { client = await Promise.race([pendingClient, interrupted]) } finally {
          if (this.connectWake === wakeConnect) this.connectWake = null
        }
        if (client === null) {
          acceptAttemptCallbacks = false
          lease.dispose(); lease = null
          void pendingClient.then(lateClient => { lateClient.close() }, () => {})
          continue
        }
        if (this.stopped) {
          lease.dispose()
          client.close()
          return
        }
        lease.dispose(); lease = null
        this.client = client
        backoff = 1000
        hasConnected = true
        this.options.onActivity?.({ phase: 'open', attempt, route: this.lastRoute })
        this.heartbeat = new HeartbeatController({
          target: client,
          onStale: error => {
            if (this.stopped) return
            this.options.onError?.(error.code + ': ' + error.message)
            client.close()
          },
        })
        if (this.options.deferHeartbeat !== true || this.heartbeatArmed) this.heartbeat.start()
        for (const waiter of this.waiters.splice(0)) waiter.resolve(client)
        await new Promise<void>(resolve => { this.closeWaiter = resolve })
        this.closeWaiter = null
        this.heartbeat.stop(); this.heartbeat = null
        this.client = null
        attempt = 1
        retryError = 'connection closed'
        if (this.lastRoute === 'direct' && this.options.connectionPolicy === 'automatic') this.preferTunnelOnce = true
      } catch (error) {
        lease?.dispose()
        if (this.stopped) return
        const failure = error instanceof Error ? error : new Error(String(error))
        const code = error instanceof TunnelError ? error.code : null
        this.setState('connecting')
        retryError = code === null ? failure.message : code + ': ' + failure.message
        this.options.onError?.(retryError)
        // Temporary Quick Tunnel WebSocket failures are often carrier/CF flakes,
        // not a dead hostname. Keep retrying; the UI may still offer a rescan.
        if (code !== null && TERMINAL_CONNECTION_ERRORS.has(code)) {
          this.terminalError = failure
          this.options.onActivity?.({ phase: 'terminal', attempt, route: this.lastRoute, error: retryError })
          for (const waiter of this.waiters.splice(0)) waiter.reject(failure)
          return
        }
      }
      if (this.stopped) return
      this.setState('connecting')
      const retryInMs = Math.round(backoff * (0.8 + random() * 0.4))
      let wakeRetry!: () => void
      const wake = new Promise<void>(resolve => { wakeRetry = resolve })
      this.retryWake = wakeRetry
      this.options.onActivity?.({
        phase: 'retry-wait', attempt, retryInMs, route: this.lastRoute,
        ...retryError === undefined ? {} : { error: retryError },
      })
      if (this.stopped) {
        if (this.retryWake === wakeRetry) this.retryWake = null
        return
      }
      await Promise.race([wait(retryInMs), wake])
      if (this.retryWake === wakeRetry) this.retryWake = null
      backoff = Math.min(backoff * 2, 60_000)
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

/** Whether the active runtime can publish the authoritative live-data event. */
export function supportsLiveDataReadiness(dataset: { readonly dshLiveDataReadiness?: string }): boolean {
  return dataset.dshLiveDataReadiness === 'v1'
}

export type LiveDataReadiness = 'pending' | 'ready' | 'error' | 'core-ready'

/** Core completes refresh from official Shell and transport lifecycle without the enhancement contract. */
export function coreLiveDataReadiness(transportOpen: boolean, shellMounted: boolean): LiveDataReadiness {
  return transportOpen && shellMounted ? 'core-ready' : 'pending'
}

/** User-facing route name: only an Automatic tunnel route is a fallback. */
export function connectionRouteLabel(
  route: 'direct' | 'tunnel' | null,
  endpointKind: 'temporary' | 'custom' | 'relay' | undefined,
  policy: ConnectionPolicy | undefined,
): string {
  if (route === 'direct') return 'WebRTC Direct'
  if (route !== 'tunnel') return ''
  if (endpointKind === 'relay') return 'Relay'
  return policy === 'tunnel-only' ? 'Tunnel' : 'Tunnel Fallback'
}

export type ConnectionRecovery = 'endpoint' | 'credential'

export interface ConnectionRecoveryNotice {
  message: string
  detail: string
  actionLabel: string
}

/** Only actionable recovery owns the topbar; transient retries stay in the connection indicator. */
export function connectionRecoveryNotice(
  recovery: ConnectionRecovery | null,
  detail: string,
): ConnectionRecoveryNotice | null {
  if (recovery === 'endpoint') {
    return { message: '电脑连接地址已失效，请重新扫码。', detail, actionLabel: '重新扫码' }
  }
  if (recovery === 'credential') {
    return { message: '登录凭证已丢失，请重新扫码。', detail, actionLabel: '重新扫码' }
  }
  return null
}

export interface ConnectionIndicatorPresentation {
  visible: boolean
  text: string
  label: string
  color: string
}

/** True while transport failures are being retried without user action. */
export function isPassiveConnectionRetry(activity: TunnelManagerActivity): boolean {
  return activity.phase === 'retry-wait'
    || (activity.phase === 'connecting' && activity.reconnecting && activity.attempt >= 3)
}

/** Pure state presentation shared by the drawer dot and floating cached-shell hint. */
export function connectionIndicatorPresentation(
  status: TunnelState | TunnelManagerActivity,
  route = '',
  shellMounted = true,
  liveDataReady: boolean | LiveDataReadiness = true,
): ConnectionIndicatorPresentation {
  if (typeof status !== 'string' && status.phase === 'terminal') {
    const title = '连接需要处理'
    return {
      visible: false,
      text: '离线',
      label: route === '' ? title : route + ' · ' + title,
      color: 'var(--dsw-alias-state-error-primary, #ec1313)',
    }
  }
  const passiveRetry = typeof status !== 'string'
    && isPassiveConnectionRetry(status)
  if (passiveRetry) {
    const title = '连接中断，后台自动重试'
    return {
      visible: shellMounted,
      text: '重连中…',
      label: route === '' ? title : route + ' · ' + title,
      color: 'var(--dsw-alias-state-warn-primary, #f59e0b)',
    }
  }
  const state: TunnelState = typeof status === 'string'
    ? status
    : status.phase === 'open'
      ? 'open'
      : status.phase === 'connecting'
        ? 'connecting'
        : 'closed'
  const reconnecting = typeof status !== 'string' && status.phase === 'connecting' && status.reconnecting
  const readiness = typeof liveDataReady === 'boolean' ? (liveDataReady ? 'ready' : 'pending') : liveDataReady
  const refreshFailed = state === 'open' && readiness === 'error'
  const refreshing = state === 'open' && readiness === 'pending'
  const connected = state === 'open' && (readiness === 'ready' || readiness === 'core-ready')
  const title = refreshFailed
    ? '会话数据刷新失败'
    : refreshing
      ? '正在刷新会话…'
      : connected
        ? '已连接'
      : state === 'connecting'
        ? reconnecting ? '正在重连…' : '隧道连接中…'
        : '隧道已断开，重连中'
  const color = state === 'closed' || refreshFailed
    ? 'var(--dsw-alias-state-error-primary, #ec1313)'
    : connected
      ? 'var(--dsw-alias-state-success-primary, #22c55e)'
      : 'var(--dsw-alias-state-warn-primary, #f59e0b)'
  const text = refreshFailed
    ? '刷新失败'
    : refreshing
      ? '刷新中…'
      : connected
        ? '已连接'
      : state === 'connecting'
        ? reconnecting ? '重连中…' : '连接中…'
        : '重连中…'
  return {
    visible: shellMounted && (state !== 'open' || (readiness !== 'ready' && readiness !== 'core-ready')),
    text,
    label: route === '' ? title : route + ' · ' + title,
    color,
  }
}

/** Mounted connection indicator controller. */
export interface ConnectionBadgeUpdater {
  (
    state: TunnelState | TunnelManagerActivity,
    route?: string,
    shellMounted?: boolean,
    liveDataReady?: boolean | LiveDataReadiness,
  ): void
  /** Remove indicator nodes and stop observing shell mutations. */
  dispose(): void
}

function scheduleOnFrame(run: () => void): () => void {
  let token = 0
  return () => {
    if (token !== 0) return
    token = requestAnimationFrame(() => {
      token = 0
      run()
    })
  }
}

function observeShellChrome(onChange: () => void): () => void {
  const observed = new WeakSet<Element>()
  const observer = new MutationObserver(scheduleOnFrame(() => {
    watchKnownChrome()
    onChange()
  }))
  const watch = (node: Element | null): void => {
    if (node === null || observed.has(node)) return
    observed.add(node)
    observer.observe(node, { childList: true })
  }
  const watchKnownChrome = (): void => {
    watch(document.getElementById('root'))
    watch(document.body)
    watch(document.querySelector(OWN_TOPBAR))
    watch(document.querySelector(OWN_DRAWER_BRAND)?.parentElement ?? null)
    watch(document.querySelector(OFFICIAL_DRAWER))
  }
  watchKnownChrome()
  onChange()
  return () => observer.disconnect()
}

/** Keep the topbar dot and a non-blocking floating cached-shell connection hint in sync. */
export function installBadge(): ConnectionBadgeUpdater {
  const el = document.createElement('span')
  el.style.cssText =
    'position:static;width:18px;height:18px;padding:2px;display:none;place-items:center;' +
    'box-sizing:border-box;flex:none;'
  el.setAttribute('role', 'status')
  el.setAttribute('aria-label', '连接状态')
  el.setAttribute('data-mobile-connection-status', '')
  const dot = document.createElement('span')
  dot.setAttribute('aria-hidden', 'true')
  dot.style.cssText =
    'display:block;width:10px;height:10px;border:2px solid rgba(255,255,255,.92);' +
    'border-radius:50%;box-sizing:border-box;box-shadow:0 1px 3px rgba(0,0,0,.28);'
  el.append(dot)

  // Cached content remains fully interactive; this pill is display-only and
  // disappears as soon as the live tunnel opens.
  const floating = document.createElement('span')
  floating.setAttribute('role', 'status')
  floating.setAttribute('aria-live', 'polite')
  floating.setAttribute('data-mobile-floating-connection-status', '')
  floating.style.cssText =
    'position:fixed;top:calc(env(safe-area-inset-top, 0px) + 58px);left:50%;' +
    'transform:translateX(-50%);z-index:2147483645;display:none;align-items:center;gap:6px;' +
    'padding:6px 10px;border:1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.12));border-radius:999px;' +
    'background:var(--dsw-alias-button-floating-fill, var(--dsw-alias-bg-layer-2, Canvas));' +
    'color:var(--dsw-alias-label-primary, CanvasText);font:500 12px/1.2 system-ui,sans-serif;' +
    'white-space:nowrap;box-shadow:0 4px 14px rgba(0,0,0,.24);backdrop-filter:blur(8px);' +
    '-webkit-backdrop-filter:blur(8px);pointer-events:none;user-select:none;'
  const floatingDot = document.createElement('span')
  floatingDot.setAttribute('aria-hidden', 'true')
  floatingDot.style.cssText = 'width:7px;height:7px;border-radius:50%;flex:none;box-shadow:0 0 0 2px rgba(255,255,255,.14);'
  const floatingText = document.createElement('span')
  floating.append(floatingDot, floatingText)

  const place = (): void => {
    const anchor = findConnectionBadgeAnchor()
    if (anchor === null) {
      el.style.display = 'none'
      return
    }
    const toggle = queryDrawerToggleSlot(anchor)
    if (toggle !== null) {
      if (el.nextElementSibling !== toggle || el.parentElement !== toggle.parentElement) {
        toggle.insertAdjacentElement('beforebegin', el)
      }
    } else if (el.previousElementSibling !== anchor || el.parentElement !== anchor.parentElement) {
      anchor.insertAdjacentElement('afterend', el)
    }
    el.style.display = 'grid'
  }
  document.body.append(el, floating)
  const stop = observeShellChrome(place)
  place()

  const update: ConnectionBadgeUpdater = (state, route = '', shellMounted = true, liveDataReady = true) => {
    const view = connectionIndicatorPresentation(state, route, shellMounted, liveDataReady)
    dot.style.background = view.color
    el.title = view.label
    el.setAttribute('aria-label', view.label)
    floating.style.display = view.visible ? 'flex' : 'none'
    floatingDot.style.background = view.color
    floatingText.textContent = view.text
    floating.title = view.label
    floating.setAttribute('aria-label', view.label)
  }
  update.dispose = () => {
    stop()
    el.remove()
    floating.remove()
  }
  return update
}

/** Add the device-switch action beside the official Settings trigger. */
export function installProfileAction(onActivate: () => void): () => void {
  const action = document.createElement('button')
  action.type = 'button'
  action.dataset.mobileProfileAction = ''
  action.setAttribute('aria-label', '切换设备并重新扫码')
  action.title = '切换设备并重新扫码'
  action.style.cssText =
    'box-sizing:border-box;flex:1 1 0!important;min-width:0!important;width:auto!important;' +
    'margin:0!important;background:transparent!important;' +
    'border:none!important;box-shadow:none!important;appearance:none;-webkit-appearance:none;'
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  icon.setAttribute('width', '16')
  icon.setAttribute('height', '16')
  icon.setAttribute('viewBox', '0 0 16 16')
  icon.setAttribute('fill', 'none')
  icon.setAttribute('aria-hidden', 'true')
  const iconPath = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  iconPath.setAttribute('d', 'M5.5 2.5H2.5v3M10.5 2.5h3v3M5.5 13.5H2.5v-3M10.5 13.5h3v-3M6 8h4')
  iconPath.setAttribute('stroke', 'currentColor')
  iconPath.setAttribute('stroke-width', '1.2')
  iconPath.setAttribute('stroke-linecap', 'round')
  iconPath.setAttribute('stroke-linejoin', 'round')
  icon.append(iconPath)
  const label = document.createElement('span')
  label.textContent = '切换设备'
  action.append(icon, label)
  action.addEventListener('click', onActivate)

  const place = (): void => {
    const settings = findSettingsTrigger()
    const area = settings?.parentElement?.parentElement
    if (settings === undefined || area === undefined || area === null) return
    // Reuse the official trigger class and its icon/label classes. Only the
    // flex sizing differs because two equal actions now share this footer row.
    action.className = settings.className
    action.style.setProperty('background', 'transparent', 'important')
    action.style.setProperty('border', 'none', 'important')
    action.style.setProperty('box-shadow', 'none', 'important')
    const settingsIcon = settings.querySelector('svg')
    if (settingsIcon !== null) icon.setAttribute('class', settingsIcon.getAttribute('class') ?? '')
    const settingsLabel = settings.querySelector('span')
    if (settingsLabel !== null) label.className = settingsLabel.className
    area.style.display = 'flex'
    area.style.alignItems = 'center'
    area.style.gap = '6px'
    area.style.width = '100%'
    settings.style.setProperty('flex', '1 1 0', 'important')
    settings.style.setProperty('min-width', '0', 'important')
    settings.style.setProperty('width', 'auto', 'important')
    settings.style.setProperty('margin', '0', 'important')
    if (action.parentElement !== settings.parentElement || action.previousElementSibling !== settings) {
      settings.insertAdjacentElement('afterend', action)
    }
  }
  document.body.append(action)
  const stop = observeShellChrome(place)
  place()
  return () => { stop(); action.remove() }
}
