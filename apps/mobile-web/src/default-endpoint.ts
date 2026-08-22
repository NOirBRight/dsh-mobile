import type { HostProfile } from './profiles.ts'

/** Public Endpoint shipped in this operator's Android build. */
export const DEFAULT_PUBLIC_ENDPOINT = 'https://pair.noirbright.top'
export const DEFAULT_PUBLIC_HOST_ID = 'c2ChEHucjWVwG7FnAF3xqfVXuIJnvoyY2kIiJHyiWmI'

export interface EndpointMigrationRepository {
  getActive(): Promise<HostProfile | undefined>
  refreshEndpoint(
    hostId: HostProfile['hostId'],
    refresh: Pick<HostProfile, 'endpoint' | 'capabilities' | 'updatedAt'>,
  ): Promise<HostProfile>
  upsert?(profile: HostProfile): Promise<HostProfile>
}

/**
 * Move an existing temporary Active Host Profile to this build's stable
 * endpoint while keeping its Host Identity, room, and vaulted credential.
 *
 * New pairings still use the endpoint carried by their QR offer. This narrow
 * migration only changes the already-authorized profile on startup, which
 * prevents a stale Quick Tunnel URL from winning over the operator endpoint.
 */
export async function migrateActiveTemporaryEndpoint(
  repository: EndpointMigrationRepository,
  endpoint = DEFAULT_PUBLIC_ENDPOINT,
  now: () => Date = () => new Date(),
): Promise<boolean> {
  const active = await repository.getActive()
  if (active === undefined || active.hostId !== DEFAULT_PUBLIC_HOST_ID) return false
  const displayName = new URL(endpoint).host
  if (active.endpoint.kind === 'custom' && active.endpoint.url === endpoint) {
    if (active.displayName === displayName || repository.upsert === undefined) return false
    await repository.upsert({ ...active, displayName })
    return true
  }
  if (active.endpoint.kind !== 'temporary') return false
  const refreshed = await repository.refreshEndpoint(active.hostId, {
    endpoint: { url: endpoint, kind: 'custom' },
    capabilities: [...active.capabilities],
    updatedAt: now().toISOString(),
  })
  if (repository.upsert !== undefined && refreshed.displayName !== displayName) {
    await repository.upsert({ ...refreshed, displayName })
  }
  return true
}
