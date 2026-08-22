import type { HostProfile } from './profiles.ts'

export interface EndpointMigrationRepository {
  getActive(): Promise<HostProfile | undefined>
  refreshEndpoint(
    hostId: HostProfile['hostId'],
    refresh: Pick<HostProfile, 'endpoint' | 'capabilities' | 'updatedAt'>,
  ): Promise<HostProfile>
  upsert?(profile: HostProfile): Promise<HostProfile>
}

/**
 * Operator-only migration helper. Product code supplies both identity and URL;
 * this module deliberately ships no maintainer-owned runtime endpoint.
 */
export async function migrateActiveTemporaryEndpoint(
  repository: EndpointMigrationRepository,
  hostId: HostProfile['hostId'],
  endpoint: string,
  now: () => Date = () => new Date(),
): Promise<boolean> {
  const active = await repository.getActive()
  if (active === undefined || active.hostId !== hostId) return false
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
