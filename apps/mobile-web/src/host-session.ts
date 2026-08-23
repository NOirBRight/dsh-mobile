/** In-shell Host session: reconnect and remount without reloading the WebView. */
import { TunnelError, type TunnelClient } from '@dsh-mobile/e2e-tunnel'
import type { ResponsiveBootSelection } from './manifest.ts'
import type { PreparedProfileConnection } from './profile-connection.ts'
import type { TunnelManagerSlot } from './tunnel.ts'

export interface SessionTunnel {
  start(): void
  stop(): void
  current(): Promise<TunnelClient>
  armHeartbeat(): void
  probeNow(): Promise<void>
}

export interface HostSessionDeps {
  slot: TunnelManagerSlot
  createManager(prepared: PreparedProfileConnection): SessionTunnel
  injectBoot(client: TunnelClient, prepared: PreparedProfileConnection): Promise<ResponsiveBootSelection>
  /** Paint a cached boot roster before the tunnel is open; null means wait for the live inject. */
  hydrateBoot?(prepared: PreparedProfileConnection): Promise<ResponsiveBootSelection | null>
  mount(selection: ResponsiveBootSelection, hostId: string): void | Promise<void>
}

export interface ShellPaintContext {
  previousHostId: string | null
  nextHostId: string
}

/** AppWebEntry is boot-once; repaint only when the Host roster actually changed. */
export function shellNeedsPaint(
  previous: ResponsiveBootSelection | null,
  next: ResponsiveBootSelection,
  hosts: ShellPaintContext,
): boolean {
  if (previous === null) return true
  if (hosts.previousHostId !== hosts.nextHostId) return true
  return previous.layout !== next.layout
    || previous.manifest.rev !== next.manifest.rev
    || previous.officialLayoutRevision !== next.officialLayoutRevision
    || previous.enhancement?.status !== next.enhancement?.status
    || (previous.enhancement?.status === 'incompatible'
      && next.enhancement?.status === 'incompatible'
      && previous.enhancement.reason !== next.enhancement.reason)
}

/** Owns one Active Host tunnel and remounts Host UI in the existing shell. */
export class HostSession {
  private manager: SessionTunnel | null = null
  private prepared: PreparedProfileConnection | null = null
  private lastSelection: ResponsiveBootSelection | null = null
  private lastHostId: string | null = null
  private generation = 0
  private readonly deps: HostSessionDeps

  constructor(deps: HostSessionDeps) {
    this.deps = deps
  }

  selection(): ResponsiveBootSelection | null { return this.lastSelection }

  /** Paint the cached shell before starting transport; the live connect reuses this selection. */
  async hydrate(prepared: PreparedProfileConnection): Promise<boolean> {
    const generation = this.generation
    this.prepared = prepared
    const cached = await this.deps.hydrateBoot?.(prepared) ?? null
    if (cached === null || generation !== this.generation) return false
    await this.paint(cached, prepared.profile.hostId)
    return true
  }

  async connect(prepared: PreparedProfileConnection): Promise<ResponsiveBootSelection> {
    this.stop()
    const generation = this.generation
    this.prepared = prepared
    const manager = this.deps.createManager(prepared)
    this.manager = manager
    this.deps.slot.attach(manager)
    manager.start()
    const cached = await this.deps.hydrateBoot?.(prepared) ?? null
    if (cached !== null && generation === this.generation) await this.paint(cached, prepared.profile.hostId)
    for (;;) {
      if (generation !== this.generation) throw new TunnelError('closed', HOST_SESSION_STOPPED_MESSAGE)
      const client = await manager.current()
      try {
        const selection = await this.deps.injectBoot(client, prepared)
        if (generation !== this.generation) return selection
        manager.armHeartbeat()
        await this.paint(selection, prepared.profile.hostId)
        return selection
      } catch (error) {
        if (generation !== this.generation) throw error
        if (!isTransientTunnelBootError(error)) throw error
        if (client.state === 'open') client.close()
      }
    }
  }

  async remount(): Promise<ResponsiveBootSelection | null> {
    if (this.prepared === null) return null
    const hostId = this.prepared.profile.hostId
    if (this.manager === null) {
      const cached = await this.deps.hydrateBoot?.(this.prepared) ?? null
      if (cached !== null) {
        await this.paint(cached, hostId)
        return cached
      }
      return this.connect(this.prepared)
    }
    const client = await this.manager.current()
    const selection = await this.deps.injectBoot(client, this.prepared)
    await this.paint(selection, hostId)
    return selection
  }

  async probeNow(): Promise<void> {
    await this.manager?.probeNow()
  }

  stop(): void {
    this.generation += 1
    this.manager?.stop()
    this.manager = null
  }

  /** Forget the last painted roster so the next connect remounts after the shell DOM was torn down. */
  forgetPaint(): void {
    this.lastSelection = null
    this.lastHostId = null
  }

  private async paint(selection: ResponsiveBootSelection, nextHostId: string): Promise<void> {
    if (!shellNeedsPaint(this.lastSelection, selection, { previousHostId: this.lastHostId, nextHostId })) {
      this.lastSelection = selection
      return
    }
    this.lastSelection = selection
    this.lastHostId = nextHostId
    await this.deps.mount(selection, nextHostId)
  }
}

export const HOST_SESSION_STOPPED_MESSAGE = 'Active Host connection stopped'

/** A superseded connect was cancelled by stop() or a newer connect(); it is not a transport failure. */
export function isHostSessionStoppedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  if (message !== HOST_SESSION_STOPPED_MESSAGE) return false
  return !(error instanceof TunnelError) || error.code === 'closed'
}

/** Boot fetch failed because the just-opened tunnel dropped or stalled; wait for the next live client. */
export function isTransientTunnelBootError(error: unknown): boolean {
  if (isHostSessionStoppedError(error)) return false
  if (error instanceof TunnelError) return error.code === 'closed' || error.code === 'handshake' || error.code === 'timeout'
  if (error instanceof Error && error.name === 'AbortError') return true
  const message = error instanceof Error ? error.message : String(error)
  return /tunnel is closed|connection closed|timed out|aborted/i.test(message)
}
