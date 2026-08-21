import { TunnelError } from './errors.ts'

export type ConnectionPolicy = 'automatic' | 'direct-only' | 'tunnel-only'
export type ConnectionRoute = 'direct' | 'tunnel'

export interface RouteCapabilities {
  direct: boolean
  tunnel: boolean
}

/** Return the only permitted route order for one connection attempt. */
export function connectionAttempts(policy: ConnectionPolicy, capabilities: RouteCapabilities): ConnectionRoute[] {
  const attempts: ConnectionRoute[] = []
  if (policy !== 'direct-only' && capabilities.tunnel) attempts.push('tunnel')
  if (policy !== 'tunnel-only' && capabilities.direct) attempts.push('direct')
  if (attempts.length === 0) {
    throw new TunnelError('no-route', `connection policy ${policy} has no available route`)
  }
  return attempts
}
