import type { ConnectionPolicy, ConnectionRoute, RouteCapabilities } from './connection-policy.ts'
import { connectionAttempts } from './connection-policy.ts'
import type { TunnelClient } from './client.ts'
import { TunnelError } from './errors.ts'

export type ConnectionPhase =
  | 'direct-connecting'
  | 'direct-open'
  | 'tunnel-connecting'
  | 'tunnel-open'
  | 'offline'

export interface ConnectionStatus {
  phase: ConnectionPhase
  route: ConnectionRoute | null
  error?: string
}

export interface ConnectionCoordinatorOptions {
  policy: ConnectionPolicy
  capabilities: RouteCapabilities
  connectDirect: (signal?: AbortSignal) => Promise<TunnelClient>
  connectTunnel: (signal?: AbortSignal) => Promise<TunnelClient>
  onState?: (status: ConnectionStatus) => void
  /**
   * Automatic only: Direct may win only if it finishes within this window.
   * After the window, late Direct is discarded and Tunnel remains the route.
   */
  directGraceMs?: number
}

/** Same-LAN Direct may steal Automatic only inside this window. */
export const DEFAULT_DIRECT_GRACE_MS = 2_000

const TERMINAL_HOST_ERRORS = new Set([
  'bad-offer', 'bad-code', 'expired', 'bad-token', 'bad-key', 'unauthorized', 'identity-mismatch', 'incompatible', 'limit',
])

/** Authentication, identity, and compatibility failures must not be hidden by route fallback. */
function mayFallbackAfter(error: unknown): boolean {
  return !(error instanceof TunnelError) || !TERMINAL_HOST_ERRORS.has(error.code)
}

/** Select one visible route at a time while keeping transport creation injectable. */
export class ConnectionCoordinator {
  private client: TunnelClient | null = null
  private route: ConnectionRoute | null = null
  private readonly options: ConnectionCoordinatorOptions

  constructor(options: ConnectionCoordinatorOptions) {
    this.options = options
  }

  get activeRoute(): ConnectionRoute | null {
    return this.route
  }

  get activeClient(): TunnelClient | null {
    return this.client
  }

  async connect(): Promise<TunnelClient> {
    this.close()
    const attempts = connectionAttempts(this.options.policy, this.options.capabilities)
    if (attempts.length === 1) return this.connectOne(attempts[0])
    return this.connectAutomatic(attempts)
  }

  private startRoute(route: ConnectionRoute, signal?: AbortSignal): Promise<TunnelClient> {
    return route === 'direct' ? this.options.connectDirect(signal) : this.options.connectTunnel(signal)
  }

  private async connectOne(route: ConnectionRoute): Promise<TunnelClient> {
    this.emit(route === 'direct' ? 'direct-connecting' : 'tunnel-connecting', route)
    try {
      const client = await this.startRoute(route)
      return this.accept(route, client)
    } catch (error) {
      const failure = error instanceof Error ? error : new TunnelError('offline', String(error))
      this.emit('offline', null, failure.message)
      throw failure
    }
  }

  /**
   * Race Tunnel (started first) with Direct. Direct may win only inside the
   * grace window; a terminal Host verdict aborts every route.
   */
  private async connectAutomatic(attempts: ConnectionRoute[]): Promise<TunnelClient> {
    for (const route of attempts) {
      this.emit(route === 'direct' ? 'direct-connecting' : 'tunnel-connecting', route)
    }
    const graceMs = this.options.directGraceMs ?? DEFAULT_DIRECT_GRACE_MS
    return new Promise<TunnelClient>((resolve, reject) => {
      let settled = false
      let pending = attempts.length
      let graceOpen = true
      let lastError: Error | null = null
      const discarded: TunnelClient[] = []
      const abortByRoute = new Map<ConnectionRoute, AbortController>()
      for (const route of attempts) abortByRoute.set(route, new AbortController())
      const abortOthers = (winner: ConnectionRoute): void => {
        for (const [route, controller] of abortByRoute) {
          if (route !== winner) controller.abort()
        }
      }
      const graceTimer = setTimeout(() => {
        graceOpen = false
        abortByRoute.get('direct')?.abort()
      }, graceMs)

      const discard = (client: TunnelClient): void => {
        discarded.push(client)
        client.discard()
      }

      const dropDiscarded = (): void => {
        for (const discardedClient of discarded) discardedClient.discard()
      }

      const failIfIdle = (error: Error): void => {
        pending -= 1
        lastError = error
        if (settled) return
        if (pending === 0) {
          settled = true
          clearTimeout(graceTimer)
          dropDiscarded()
          this.emit('offline', null, error.message)
          reject(error)
        }
      }

      const finishOk = (route: ConnectionRoute, client: TunnelClient): void => {
        if (settled) {
          discard(client)
          return
        }
        if (route === 'direct' && !graceOpen) {
          discard(client)
          failIfIdle(lastError ?? new TunnelError('offline', 'Direct finished after grace window'))
          return
        }
        settled = true
        clearTimeout(graceTimer)
        abortOthers(route)
        dropDiscarded()
        resolve(this.accept(route, client))
      }

      const finishErr = (error: Error, terminal: boolean): void => {
        lastError = error
        pending -= 1
        if (settled) return
        if (terminal || pending === 0) {
          settled = true
          clearTimeout(graceTimer)
          for (const controller of abortByRoute.values()) controller.abort()
          dropDiscarded()
          this.emit('offline', null, error.message)
          reject(error)
        }
      }

      for (const route of attempts) {
        void this.startRoute(route, abortByRoute.get(route)?.signal).then(
          client => finishOk(route, client),
          error => {
            const failure = error instanceof Error ? error : new TunnelError('offline', String(error))
            finishErr(failure, !mayFallbackAfter(error))
          },
        )
      }
    })
  }

  private accept(route: ConnectionRoute, client: TunnelClient): TunnelClient {
    this.client = client
    this.route = route
    this.emit(route === 'direct' ? 'direct-open' : 'tunnel-open', route)
    return client
  }

  async probe(timeoutMs?: number): Promise<void> {
    if (this.client === null) throw new TunnelError('closed', 'no Active Host connection')
    await this.client.probe(timeoutMs)
  }

  close(): void {
    const client = this.client
    this.client = null
    this.route = null
    client?.close()
  }

  private emit(phase: ConnectionPhase, route: ConnectionRoute | null, error?: string): void {
    this.options.onState?.({ phase, route, ...(error === undefined ? {} : { error }) })
  }
}
