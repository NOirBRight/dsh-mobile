export type PairingTarget = 'android'

/** Settings nav id/order: immediately after official General. */
export const REMOTE_SETTINGS_SECTION = { id: 'remote', order: 5 } as const

export interface PairingStatus {
  endpoint: null | { url: string; kind: 'temporary' | 'custom' }
  endpointMode: 'quick' | 'custom'
  customEndpointUrl?: string | null
  hostIdentity: string
  configuration: { file: string; entryId: string; customEndpointField: string; legacyRelayConfigured: boolean }
}

export type EndpointSaveStage = 'endpoint' | 'tls' | 'identity' | 'protocol' | 'capabilities' | 'websocket'

export interface EndpointSaveRequest {
  endpointMode: 'quick' | 'custom'
  customEndpointUrl?: string
}

export type EndpointSaveResult =
  | { ok: true; endpointMode: 'quick' | 'custom'; endpoint: PairingStatus['endpoint'] }
  | { ok: false; stage: EndpointSaveStage; error: string }

export function decodePairingStatus(value: unknown): PairingStatus | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const endpointMode = record.endpointMode
  const hostIdentity = record.hostIdentity
  const configuration = record.configuration
  if (endpointMode !== 'quick' && endpointMode !== 'custom') return null
  if (typeof hostIdentity !== 'string' || typeof configuration !== 'object' || configuration === null) return null
  const config = configuration as Record<string, unknown>
  if (typeof config.file !== 'string' || typeof config.entryId !== 'string' || typeof config.customEndpointField !== 'string' || typeof config.legacyRelayConfigured !== 'boolean') return null
  let endpoint: PairingStatus['endpoint'] = null
  if (record.endpoint !== null) {
    if (typeof record.endpoint !== 'object') return null
    const raw = record.endpoint as Record<string, unknown>
    if (typeof raw.url !== 'string' || (raw.kind !== 'temporary' && raw.kind !== 'custom')) return null
    endpoint = { url: raw.url, kind: raw.kind }
  }
  const customEndpointUrl = record.customEndpointUrl
  if (customEndpointUrl !== undefined && customEndpointUrl !== null && typeof customEndpointUrl !== 'string') return null
  return {
    endpoint, endpointMode, hostIdentity,
    ...(typeof customEndpointUrl === 'string' ? { customEndpointUrl } : {}),
    configuration: { file: config.file, entryId: config.entryId, customEndpointField: config.customEndpointField, legacyRelayConfigured: config.legacyRelayConfigured },
  }
}

export function buildEndpointSaveRequest(mode: 'quick' | 'custom', customUrl: string): EndpointSaveRequest | { error: string } {
  if (mode === 'quick') return { endpointMode: 'quick' }
  const trimmed = customUrl.trim()
  if (trimmed === '') return { error: 'customEndpointUrl is required in custom mode' }
  return { endpointMode: 'custom', customEndpointUrl: trimmed }
}

/** True when the editor does not match the Host's saved Public Endpoint. */
export function endpointDraftDirty(
  mode: 'quick' | 'custom',
  customUrl: string,
  status: Pick<PairingStatus, 'endpointMode' | 'customEndpointUrl'>,
): boolean {
  if (mode !== status.endpointMode) return true
  return mode === 'custom' && customUrl.trim() !== (status.customEndpointUrl ?? '').trim()
}

export function decodeEndpointSaveResult(value: unknown): EndpointSaveResult | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (record.ok === true) {
    if (record.endpointMode !== 'quick' && record.endpointMode !== 'custom') return null
    let endpoint: PairingStatus['endpoint'] = null
    if (record.endpoint !== null && record.endpoint !== undefined) {
      if (typeof record.endpoint !== 'object') return null
      const raw = record.endpoint as Record<string, unknown>
      if (typeof raw.url !== 'string' || (raw.kind !== 'temporary' && raw.kind !== 'custom')) return null
      endpoint = { url: raw.url, kind: raw.kind }
    }
    return { ok: true, endpointMode: record.endpointMode, endpoint }
  }
  if (record.ok !== false || typeof record.error !== 'string') return null
  if (record.stage !== 'endpoint' && record.stage !== 'tls' && record.stage !== 'identity' && record.stage !== 'protocol' && record.stage !== 'capabilities' && record.stage !== 'websocket') return null
  return { ok: false, stage: record.stage, error: record.error }
}

export function pairingQrRevisionOnToggle(revision: number, opening: boolean): number {
  return opening ? revision + 1 : revision
}

export function pairingQrUrl(target: PairingTarget, revision: number): string {
  return `/pair?target=${target}&format=svg&refresh=${revision}`
}

export interface PairedDevice {
  id: string
  label?: string
  clientType?: 'android'
  createdAt: number
  lastSeenAt: number
  revokedAt: number | null
  room?: string
}

export function decodePairedDevices(value: unknown): PairedDevice[] | null {
  if (typeof value !== 'object' || value === null) return null
  const list = (value as Record<string, unknown>).devices
  if (!Array.isArray(list)) return null
  const devices: PairedDevice[] = []
  for (const item of list) {
    if (typeof item !== 'object' || item === null) return null
    const record = item as Record<string, unknown>
    if (typeof record.id !== 'string' || typeof record.createdAt !== 'number') return null
    const lastSeenAt = typeof record.lastSeenAt === 'number' ? record.lastSeenAt : record.createdAt
    const revokedAt = record.revokedAt === null || record.revokedAt === undefined ? null : typeof record.revokedAt === 'number' ? record.revokedAt : null
    if (record.revokedAt !== undefined && record.revokedAt !== null && typeof record.revokedAt !== 'number') return null
    devices.push({
      id: record.id,
      createdAt: record.createdAt,
      lastSeenAt,
      revokedAt,
      ...(typeof record.label === 'string' ? { label: record.label } : {}),
      ...(record.clientType === 'android' ? { clientType: record.clientType } : {}),
      ...(typeof record.room === 'string' ? { room: record.room } : {}),
    })
  }
  return devices
}

export function pairingRefreshQrUrl(room: string, revision: number): string {
  return `/pair?format=svg&room=${encodeURIComponent(room)}&refresh=${revision}`
}

export function livePairedDevices(devices: readonly PairedDevice[]): PairedDevice[] {
  return devices.filter(device => device.revokedAt === null)
}
