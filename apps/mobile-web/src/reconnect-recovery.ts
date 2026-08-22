import type { EndpointKind } from './profiles.ts'

export type ConnectionRecoveryDecision = 'endpoint' | 'credential'

/** Decide whether retry can continue unattended or must transfer to one user recovery action. */
export function connectionRecoveryDecision(
  endpointKind: EndpointKind,
  phase: 'connecting' | 'retry-wait' | 'open' | 'terminal',
  message: string,
): ConnectionRecoveryDecision | null {
  if (endpointRefreshRequired(endpointKind, message)) return 'endpoint'
  if (/credential is missing/i.test(message) || phase === 'terminal') return 'credential'
  return null
}

/** A temporary Public Endpoint cannot self-advertise its replacement after its hostname dies. */
export function endpointRefreshRequired(endpointKind: EndpointKind, message: string): boolean {
  if (endpointKind !== 'temporary') return false
  return /(?:endpoint|signaling) WebSocket connection failed/i.test(message)
}
