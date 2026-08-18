import type { EndpointKind } from './profiles.ts'

/** A temporary Public Endpoint cannot self-advertise its replacement after its hostname dies. */
export function endpointRefreshRequired(endpointKind: EndpointKind, message: string): boolean {
  if (endpointKind !== 'temporary') return false
  return /(?:endpoint|signaling) WebSocket connection failed/i.test(message)
}
