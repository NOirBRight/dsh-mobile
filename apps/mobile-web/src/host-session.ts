/** In-shell Host session: reconnect and remount without reloading the WebView. */
import { TunnelError, type TunnelClient } from '@dsh-mobile/e2e-tunnel'
import type { ResponsiveBootSelection } from './manifest.ts'
import type { PreparedProfileConnection } from './profile-connection.ts'
import type { TunnelManagerActivity, TunnelManagerSlot } from './tunnel.ts'

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
}

/** A resident shell must refresh the Host roster after transport-level recovery. */
export function transportOpenNeedsBootRefresh(
  previous: TunnelManagerActivity,
  next: TunnelManagerActivity,
  shellMounted: boolean,
): boolean {
  return shellMounted
    && previous.phase === 'connecting'
    && previous.reconnecting
    && next.phase === 'open'
}

/** Owns one Active Host tunnel and remounts Host UI in the existing shell. */
export class HostSession {
  private manager: SessionTunnel | null = null
  private prepared: PreparedProfileConnection | null = null
  private lastSelection: ResponsiveBootSelection | null = null
  private lastHostId: string | null = null
  private generation = 0
  private bootGeneration = 0
  private paintTail: Promise<void> = Promise.resolve()
  private readonly deps: HostSessionDeps

  constructor(deps: HostSessionDeps) {
    this.deps = deps
  }

  selection(): ResponsiveBootSelection | null { return this.lastSelection }

  /** Refresh the Host roster only when a resident transport recovered from reconnecting. */
  refreshAfterTransportActivity(
    previous: TunnelManagerActivity,
    next: TunnelManagerActivity,
    shellMounted: boolean,
  ): Promise<ResponsiveBootSelection | null> | null {
    return transportOpenNeedsBootRefresh(previous, next, shellMounted) ? this.remount() : null
  }

  /** Paint the cached shell before starting transport; the live connect reuses this selection. */
  async hydrate(prepared: PreparedProfileConnection): Promise<boolean> {
    const generation = this.generation
    const bootGeneration = ++this.bootGeneration
    this.prepared = prepared
    const cached = await this.deps.hydrateBoot?.(prepared) ?? null
    if (cached === null || generation !== this.generation || bootGeneration !== this.bootGeneration) return false
    await this.paint(cached, prepared.profile.hostId, bootGeneration)
    return true
  }

  async connect(prepared: PreparedProfileConnection): Promise<ResponsiveBootSelection | null> {
    this.stop()
    const generation = this.generation
    const bootGeneration = ++this.bootGeneration
    this.prepared = prepared
    const manager = this.deps.createManager(prepared)
    this.manager = manager
    this.deps.slot.attach(manager)
    manager.start()
    const superseded = (): boolean => this.manager !== null
      && (generation !== this.generation || bootGeneration !== this.bootGeneration)
    let cached: ResponsiveBootSelection | null
    try {
      cached = await this.deps.hydrateBoot?.(prepared) ?? null
    } catch (error) {
      if (superseded()) return null
      if (generation !== this.generation) throw new TunnelError('closed', HOST_SESSION_STOPPED_MESSAGE)
      if (bootGeneration !== this.bootGeneration) return null
      throw error
    }
    if (cached !== null && generation === this.generation && bootGeneration === this.bootGeneration) {
      await this.paint(cached, prepared.profile.hostId, bootGeneration)
    }
    for (;;) {
      if (superseded()) return null
      if (generation !== this.generation) throw new TunnelError('closed', HOST_SESSION_STOPPED_MESSAGE)
      if (bootGeneration !== this.bootGeneration) return null
      let client: TunnelClient | null = null
      try {
        client = await manager.current()
        if (superseded()) return null
        if (generation !== this.generation) throw new TunnelError('closed', HOST_SESSION_STOPPED_MESSAGE)
        if (bootGeneration !== this.bootGeneration) return null
        const selection = await this.deps.injectBoot(client, prepared)
        if (superseded()) return null
        if (generation !== this.generation) throw new TunnelError('closed', HOST_SESSION_STOPPED_MESSAGE)
        if (bootGeneration !== this.bootGeneration) return null
        manager.armHeartbeat()
        await this.paint(selection, prepared.profile.hostId, bootGeneration)
        if (superseded()) return null
        if (generation !== this.generation) throw new TunnelError('closed', HOST_SESSION_STOPPED_MESSAGE)
        return bootGeneration === this.bootGeneration ? selection : null
      } catch (error) {
        if (superseded()) return null
        if (generation !== this.generation) throw new TunnelError('closed', HOST_SESSION_STOPPED_MESSAGE)
        if (bootGeneration !== this.bootGeneration) return null
        if (!isTransientTunnelBootError(error)) throw error
        if (client?.state === 'open') client.close()
      }
    }
  }

  async remount(): Promise<ResponsiveBootSelection | null> {
    const prepared = this.prepared
    if (prepared === null) return null
    const bootGeneration = ++this.bootGeneration
    const hostId = prepared.profile.hostId
    const manager = this.manager
    if (manager === null) {
      try {
        const cached = await this.deps.hydrateBoot?.(prepared) ?? null
        if (bootGeneration !== this.bootGeneration) return null
        if (cached !== null) {
          await this.paint(cached, hostId, bootGeneration)
          return bootGeneration === this.bootGeneration ? cached : null
        }
        return this.connect(prepared)
      } catch (error) {
        if (bootGeneration !== this.bootGeneration) return null
        throw error
      }
    }
    try {
      const client = await manager.current()
      if (bootGeneration !== this.bootGeneration) return null
      const selection = await this.deps.injectBoot(client, prepared)
      await this.paint(selection, hostId, bootGeneration)
      return bootGeneration === this.bootGeneration ? selection : null
    } catch (error) {
      if (bootGeneration !== this.bootGeneration) return null
      throw error
    }
  }

  async probeNow(): Promise<void> {
    await this.manager?.probeNow()
  }

  stop(): void {
    this.generation += 1
    this.bootGeneration += 1
    this.manager?.stop()
    this.manager = null
  }

  /** Forget the last painted roster so the next connect remounts after the shell DOM was torn down. */
  forgetPaint(): void {
    this.lastSelection = null
    this.lastHostId = null
  }

  private paint(selection: ResponsiveBootSelection, nextHostId: string, bootGeneration: number): Promise<void> {
    const run = async (): Promise<void> => {
      if (bootGeneration !== this.bootGeneration) return
      if (!shellNeedsPaint(this.lastSelection, selection, { previousHostId: this.lastHostId, nextHostId })) {
        this.lastSelection = selection
        return
      }
      await this.deps.mount(selection, nextHostId)
      if (bootGeneration !== this.bootGeneration) return
      this.lastSelection = selection
      this.lastHostId = nextHostId
    }
    const pending = this.paintTail.then(run, run)
    this.paintTail = pending.catch(() => {})
    return pending
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
