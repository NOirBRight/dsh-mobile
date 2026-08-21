import { TunnelError } from './errors.ts'

export interface HeartbeatTarget {
  probe(timeoutMs?: number): Promise<void>
}

export interface HeartbeatScheduler {
  setTimeout(callback: () => void | Promise<void>, delayMs: number): unknown
  clearTimeout(handle: unknown): void
}

export interface HeartbeatOptions {
  target: HeartbeatTarget
  onStale: (error: TunnelError) => void
  scheduler?: HeartbeatScheduler
  intervalMs?: number
  pongTimeoutMs?: number
  maxMisses?: number
}

const defaultScheduler: HeartbeatScheduler = {
  setTimeout(callback, delayMs) { return globalThis.setTimeout(callback, delayMs) },
  clearTimeout(handle) { globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>) },
}

/** Foreground liveness loop shared by WebRTC and Tunnel Fallback sessions. */
export class HeartbeatController {
  private readonly options: Required<Pick<HeartbeatOptions, 'intervalMs' | 'pongTimeoutMs' | 'maxMisses'>> & HeartbeatOptions
  private readonly scheduler: HeartbeatScheduler
  private timer: unknown = null
  private running = false
  private missed = 0
  private probePromise: Promise<void> | null = null

  constructor(options: HeartbeatOptions) {
    this.options = { intervalMs: 20_000, pongTimeoutMs: 15_000, maxMisses: 3, ...options }
    this.scheduler = options.scheduler ?? defaultScheduler
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.missed = 0
    this.schedule()
  }

  stop(): void {
    this.running = false
    if (this.timer !== null) this.scheduler.clearTimeout(this.timer)
    this.timer = null
  }

  /** Immediate probe used on foreground resume and network change. */
  probeNow(): Promise<void> {
    if (this.probePromise !== null) return this.probePromise
    const run = this.options.target.probe(this.options.pongTimeoutMs).then(
      () => { this.missed = 0 },
      (error: unknown) => {
        this.missed += 1
        if (this.missed >= this.options.maxMisses) {
          const stale = error instanceof TunnelError ? error : new TunnelError('stale', error instanceof Error ? error.message : String(error))
          this.stop()
          this.options.onStale(stale)
        }
      },
    ).finally(() => { this.probePromise = null })
    this.probePromise = run
    return run
  }

  private schedule(): void {
    if (!this.running) return
    this.timer = this.scheduler.setTimeout(async () => {
      this.timer = null
      await this.probeNow()
      this.schedule()
    }, this.options.intervalMs)
  }
}
