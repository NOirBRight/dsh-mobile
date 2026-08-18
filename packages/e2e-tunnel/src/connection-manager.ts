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
  connectDirect: () => Promise<TunnelClient>
  connectTunnel: () => Promise<TunnelClient>
  onState?: (status: ConnectionStatus) => void
}

const TERMINAL_DIRECT_ERRORS = new Set([
  'bad-offer', 'bad-code', 'expired', 'bad-token', 'bad-key', 'unauthorized', 'identity-mismatch', 'incompatible', 'limit',
])

/** Authentication, identity, and compatibility failures must not be hidden by route fallback. */
function mayFallbackAfter(error: unknown): boolean {
  return !(error instanceof TunnelError) || !TERMINAL_DIRECT_ERRORS.has(error.code)
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
    let lastError: unknown = null
    for (const route of attempts) {
      this.emit(route === 'direct' ? 'direct-connecting' : 'tunnel-connecting', route)
      try {
        const client = await (route === 'direct' ? this.options.connectDirect() : this.options.connectTunnel())
        this.client = client
        this.route = route
        this.emit(route === 'direct' ? 'direct-open' : 'tunnel-open', route)
        return client
      } catch (error) {
        lastError = error
        if (route === 'direct' && !mayFallbackAfter(error)) {
          const terminal = error instanceof Error ? error : new TunnelError('offline', String(error))
          this.emit('offline', null, terminal.message)
          throw terminal
        }
      }
    }
    const error = lastError instanceof Error ? lastError : new TunnelError('offline', 'no connection route succeeded')
    this.emit('offline', null, error.message)
    throw error
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
