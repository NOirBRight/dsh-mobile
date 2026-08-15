/**
 * Tunnel integration for the mobile shell: offer bootstrap, connection
 * manager with reconnect, and the fetch/WebSocket shims that route the
 * shell's same-origin traffic through the E2E tunnel (docs/tunnel-protocol.md).
 *
 * Offer persistence: a scanned #offer= URL is moved to localStorage and the
 * hash is stripped (screenshots/shares must not leak it); later boots reuse
 * the stored offer. A new scan overwrites it. The offer is the durable
 * connection credential — the deviceToken (permanent until revoked) reconnects it.
 */
import { connect, parseOffer, TunnelError } from '@dsh-mobile/e2e-tunnel'
import type { TunnelClient, TunnelState } from '@dsh-mobile/e2e-tunnel'

const OFFER_KEY = 'dsh-mobile.offer'
const DEVICE_KEY = 'dsh-mobile.deviceToken'

/**
 * Fetch the boot manifest through the tunnel and install it as
 * window.__DSH_BOOT__. The VPS serves the raw dist (no host-side injection),
 * so the roster the shell needs must come from the home dsh — through the
 * tunnel, before AppWebEntry runs (upstream format: modules/src/index.ts
 * injectBootManifest).
 */
export async function injectBootManifestFromTunnel(client: TunnelClient): Promise<void> {
  const res = await client.fetch('/')
  if (!res.ok) throw new Error('boot manifest fetch failed: HTTP ' + res.status)
  const html = await res.text()
  const match = /window\.__DSH_BOOT__ = (\{.*?\})<\/script>/s.exec(html)
  if (match === null) throw new Error('boot manifest not found in tunneled index')
  ;(window as unknown as { __DSH_BOOT__: unknown }).__DSH_BOOT__ = JSON.parse(match[1])
}

/** Read the active offer: fresh #offer= hash wins and is persisted; else the stored one. */
export function readOfferUrl(): string | null {
  if (/#offer=/.test(location.hash)) {
    const url = location.href
    localStorage.setItem(OFFER_KEY, url)
    history.replaceState(null, '', location.pathname + location.search)
    return url
  }
  return localStorage.getItem(OFFER_KEY)
}

/** Whether a device token from a previous pairing is stored. */
export function hasDeviceToken(): boolean {
  return localStorage.getItem(DEVICE_KEY) !== null
}

/** Forget offer + device token (pair with a different host / start over). */
export function clearPairing(): void {
  localStorage.removeItem(OFFER_KEY)
  localStorage.removeItem(DEVICE_KEY)
}

/** Manages the tunnel lifecycle: connect, expose the open client, reconnect forever. */
export class TunnelManager {
  private client: TunnelClient | null = null
  private waiters: ((client: TunnelClient) => void)[] = []
  private closeWaiter: (() => void) | null = null
  private stopped = false
  private state: TunnelState = 'connecting'

  constructor(
    private readonly offerUrl: string,
    private readonly onState: (state: TunnelState) => void,
    /** Diagnostic surface for connection failures (debug line on the boot screen). */
    private readonly onError?: (message: string) => void,
  ) {}

  start(): void {
    void this.loop()
  }

  private setState(state: TunnelState): void {
    this.state = state
    this.onState(state)
    if (state === 'closed') this.closeWaiter?.()
  }

  private async loop(): Promise<void> {
    let backoff = 1000
    while (!this.stopped) {
      try {
        const client = await connect(this.offerUrl, {
          deviceToken: localStorage.getItem(DEVICE_KEY) ?? undefined,
          onDeviceToken: (token) => localStorage.setItem(DEVICE_KEY, token),
          onStateChange: (state) => this.setState(state),
        })
        this.client = client
        backoff = 1000
        for (const wake of this.waiters.splice(0)) wake(client)
        await new Promise<void>((resolve) => {
          this.closeWaiter = resolve
        })
        this.closeWaiter = null
        this.client = null
      } catch (error) {
        // Host verdicts: a dead device token is dropped; transport failures keep it.
        if (error instanceof TunnelError && error.code === 'bad-token') {
          localStorage.removeItem(DEVICE_KEY)
        }
        const code = error instanceof TunnelError ? error.code : null
        this.onError?.(code !== null ? code + ': ' + (error as Error).message : String(error))
      }
      if (this.stopped) return
      this.setState('connecting')
      await new Promise((resolve) => setTimeout(resolve, backoff))
      backoff = Math.min(backoff * 2, 10_000)
    }
  }

  /** The open client; waits out the current (re)connect when the tunnel is down. */
  current(): Promise<TunnelClient> {
    if (this.client !== null) return Promise.resolve(this.client)
    return new Promise((resolve) => this.waiters.push(resolve))
  }
}

type Handler = (ev: never) => void

/**
 * WebSocket facade that defers to client.openWebSocket once the tunnel is
 * open (the shell opens its downlinks during boot, usually before the tunnel
 * campaign lands). send() is queued until open; cross-origin URLs bypass the
 * tunnel entirely and construct a native socket.
 */
class DeferredWebSocket {
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

  constructor(mgr: TunnelManager, NativeWS: typeof WebSocket, url: string | URL, protocols?: string | string[]) {
    const u = new URL(String(url), location.origin)
    // Compare by HOST, not origin: the shell builds downlinks as ws(s)://<host>/api/...,
    // and wss://x != https://x as origins even for the same server.
    if (u.host !== location.host) {
      this.bind(new NativeWS(String(url), protocols) as never)
      return
    }
    void mgr.current().then((client) => {
      if (this.forced === 3) return
      this.bind(client.openWebSocket(u.pathname + u.search) as never)
    })
  }

  private bind(sock: DeferredWebSocket['inner']): void {
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

/** Route the shell's same-origin fetch/WebSocket traffic through the tunnel. */
export function installShims(mgr: TunnelManager): void {
  const nativeFetch = window.fetch.bind(window)
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const u = new URL(raw, location.origin)
    if (u.origin !== location.origin) return nativeFetch(input, init)
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
export function installBadge(): (state: TunnelState) => void {
  const el = document.createElement('div')
  el.style.cssText =
    'position:fixed;right:12px;bottom:calc(12px + env(safe-area-inset-bottom));width:10px;height:10px;' +
    'border-radius:50%;z-index:9999;transition:background .3s;box-shadow:0 0 0 2px rgba(0,0,0,.15)'
  document.body.appendChild(el)
  const titles: Record<TunnelState, string> = { open: '隧道已连接', connecting: '隧道连接中…', closed: '隧道已断开,重连中' }
  return (state) => {
    el.style.background = state === 'open' ? '#22c55e' : state === 'connecting' ? '#eab308' : '#ef4444'
    el.title = titles[state]
  }
}
