/** Publish Host `ctx.connection.state` so the shell badge can match `$events`. */

export const HOST_CONNECTION_STATE_EVENT = 'dsh:host-connection-state'

export type HostConnectionState = 'connected' | 'disconnected' | 'connecting'

export interface HostConnectionStateSource {
  getSnapshot(): HostConnectionState | undefined
  subscribe(listener: () => void): () => void
}

export function asHostConnectionState(value: unknown): HostConnectionState | undefined {
  return value === 'connected' || value === 'disconnected' || value === 'connecting'
    ? value
    : undefined
}

/** Dispatch the current Host generation state whenever Connection publishes it. */
export function installHostConnectionPresenter(
  connection: { readonly state: HostConnectionStateSource },
  target: EventTarget = globalThis.document,
): () => void {
  const publish = (): void => {
    const state = asHostConnectionState(connection.state.getSnapshot())
    target.dispatchEvent(new CustomEvent(HOST_CONNECTION_STATE_EVENT, { detail: { state } }))
  }
  const off = connection.state.subscribe(publish)
  publish()
  return off
}
