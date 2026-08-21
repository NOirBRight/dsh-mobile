/** In-shell Host session: reconnect and remount without reloading the WebView. */
import type { TunnelClient } from '@dsh-mobile/e2e-tunnel'
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
  mount(selection: ResponsiveBootSelection): void | Promise<void>
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

/** Owns one Active Host tunnel and remounts Host UI in the existing shell. */
export class HostSession {
  private manager: SessionTunnel | null = null
  private prepared: PreparedProfileConnection | null = null
  private lastSelection: ResponsiveBootSelection | null = null
  private lastHostId: string | null = null
  private readonly deps: HostSessionDeps

  constructor(deps: HostSessionDeps) {
    this.deps = deps
  }

  selection(): ResponsiveBootSelection | null { return this.lastSelection }

  async connect(prepared: PreparedProfileConnection): Promise<ResponsiveBootSelection> {
    this.stop()
    this.prepared = prepared
    const manager = this.deps.createManager(prepared)
    this.manager = manager
    this.deps.slot.attach(manager)
    manager.start()
    const cached = await this.deps.hydrateBoot?.(prepared) ?? null
    if (cached !== null) await this.paint(cached, prepared.profile.hostId)
    const client = await manager.current()
    const selection = await this.deps.injectBoot(client, prepared)
    manager.armHeartbeat()
    await this.paint(selection, prepared.profile.hostId)
    return selection
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
    this.manager?.stop()
    this.manager = null
  }

  private async paint(selection: ResponsiveBootSelection, nextHostId: string): Promise<void> {
    if (!shellNeedsPaint(this.lastSelection, selection, { previousHostId: this.lastHostId, nextHostId })) {
      this.lastSelection = selection
      return
    }
    this.lastSelection = selection
    this.lastHostId = nextHostId
    await this.deps.mount(selection)
  }
}
