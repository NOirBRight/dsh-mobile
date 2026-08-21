/** Lifecycle owner for one Cloudflare Quick Tunnel child process. */
import type { Readable } from 'node:stream'

export type QuickTunnelStatus =
  | { state: 'starting' }
  | { state: 'ready'; endpoint: string }
  | { state: 'rotated'; endpoint: string; previousEndpoint: string }
  | { state: 'error'; error: string }
  | { state: 'stopped' }

export interface QuickTunnelChild {
  stdout: Readable | null
  stderr: Readable | null
  once(event: 'error', listener: (error: Error) => void): unknown
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown
  kill(signal?: NodeJS.Signals): boolean
}
export interface QuickTunnelProvider {
  command: string
  args(localGateway: string): string[]
  endpointPattern?: RegExp
}

export const CLOUDFLARED_QUICK_PROVIDER: QuickTunnelProvider = {
  command: 'cloudflared',
  args: (localGateway) => ['tunnel', '--url', localGateway, '--no-autoupdate'],
}

export interface QuickTunnelOptions {
  spawn(command: string, args: string[]): QuickTunnelChild
  onStatus(status: QuickTunnelStatus): void
  /** When set, an unexpected child exit starts another process against the same local Gateway. */
  restartOnUnexpectedExit?: boolean
  /** Command that yields an HTTPS+WSS URL. Defaults to cloudflared. */
  provider?: QuickTunnelProvider
}
const QUICK_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/ig

function publicHttpsEndpoint(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') return null
    return url.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

export class QuickTunnelController {
  private child: QuickTunnelChild | null = null
  private currentEndpoint: string | null = null
  private currentLocal: string | null = null
  private stopping = false
  private readonly options: QuickTunnelOptions
  private onStatus: QuickTunnelOptions['onStatus']
  constructor(options: QuickTunnelOptions) {
    this.options = options
    this.onStatus = options.onStatus
  }
  endpoint(): string | null { return this.currentEndpoint }
  localGateway(): string | null { return this.currentLocal }
  alive(): boolean { return this.child !== null && !this.stopping }
  start(localGateway: string): void {
    if (this.child !== null) throw new Error('Quick Tunnel is already running')
    const local = new URL(localGateway)
    if (local.protocol !== 'http:' || !['127.0.0.1', '::1', 'localhost'].includes(local.hostname)) throw new Error('Quick Tunnel origin must be a loopback HTTP Gateway')
    this.stopping = false
    this.currentLocal = localGateway
    this.spawnChild()
  }
  /** Keep the child process; used when the pairing plugin reloads. */
  detach(): void {}
  /** Bind a new apply's status listener after detach/reuse. */
  reattach(onStatus: QuickTunnelOptions['onStatus']): void { this.onStatus = onStatus }
  async stop(): Promise<void> {
    const child = this.child
    this.stopping = true
    this.child = null
    this.currentEndpoint = null
    this.currentLocal = null
    if (child !== null) child.kill('SIGTERM')
    this.onStatus({ state: 'stopped' })
  }
  private spawnChild(): void {
    const localGateway = this.currentLocal
    if (localGateway === null) throw new Error('Quick Tunnel origin is missing')
    this.onStatus({ state: 'starting' })
    const provider = this.options.provider ?? CLOUDFLARED_QUICK_PROVIDER
    const child = this.options.spawn(provider.command, provider.args(localGateway))
    this.child = child
    let buffered = ''
    const consume = (chunk: Buffer | string): void => {
      if (this.stopping || this.child !== child) return
      buffered = (buffered + chunk.toString()).slice(-8192)
      for (const match of buffered.matchAll(provider.endpointPattern ?? QUICK_URL)) {
        const endpoint = publicHttpsEndpoint(match[0])
        if (endpoint === null || endpoint === this.currentEndpoint) continue
        const previous = this.currentEndpoint
        this.currentEndpoint = endpoint
        this.onStatus(previous === null ? { state: 'ready', endpoint } : { state: 'rotated', endpoint, previousEndpoint: previous })
      }
    }
    child.stdout?.on('data', consume); child.stderr?.on('data', consume)
    child.once('error', error => {
      if (this.child !== child) return
      this.child = null; this.currentEndpoint = null
      this.onStatus({ state: 'error', error: error.message })
    })
    child.once('exit', (code, signal) => {
      if (this.child !== child) return
      this.child = null
      if (this.stopping || code === 0) {
        this.currentEndpoint = null
        this.onStatus({ state: 'stopped' })
        return
      }
      if (this.options.restartOnUnexpectedExit === true && this.currentLocal !== null) {
        this.spawnChild()
        return
      }
      this.currentEndpoint = null
      this.onStatus({ state: 'error', error: 'cloudflared exited ' + (signal ?? code) })
    })
  }
}
