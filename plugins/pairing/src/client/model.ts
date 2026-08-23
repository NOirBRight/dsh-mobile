export type PairingTarget = 'android'

/** Screen-space budget for dense v4 offers: at least 4 px/module through QR version 14. */
export const PAIRING_QR_PRESENTATION = { size: 360, padding: 12 } as const

/** Host pairing codes live this long; the on-screen QR must rotate sooner. */
export const PAIRING_OFFER_TTL_MS = 300_000

/** Remint cadence for a visible pairing QR. Must stay below {@link PAIRING_OFFER_TTL_MS}. */
export const PAIRING_QR_ROTATE_MS = 20_000

export function pairingQrNeedsRefresh(mintedAtMs: number, nowMs: number, rotateMs = PAIRING_QR_ROTATE_MS, ttlMs = PAIRING_OFFER_TTL_MS): boolean {
  if (rotateMs >= ttlMs) return true
  return nowMs - mintedAtMs >= rotateMs
}

/** Settings nav id/order: immediately after official General. */
export const REMOTE_SETTINGS_SECTION = { id: 'remote', order: 5 } as const

export type EndpointProvisionState = 'loading' | 'ready' | 'error'

export interface PairingStatus {
  endpoint: null | { url: string; kind: 'temporary' | 'custom' | 'relay' }
  endpointMode: 'quick' | 'custom' | 'relay'
  endpointState: EndpointProvisionState
  endpointError?: string | null
  customEndpointUrl?: string | null
  relayUrl?: string | null
  hostIdentity: string
  configuration: { file: string; entryId: string; customEndpointField: string; relayEndpointField?: string; legacyRelayConfigured: boolean; relayConfigured?: boolean }
}

export type EndpointSaveStage = 'endpoint' | 'tls' | 'identity' | 'protocol' | 'capabilities' | 'websocket' | 'relay'

export interface EndpointSaveRequest {
  endpointMode: 'quick' | 'custom' | 'relay'
  customEndpointUrl?: string
  relayUrl?: string
}

export type EndpointSaveResult =
  | { ok: true; endpointMode: 'quick' | 'custom' | 'relay'; endpoint: PairingStatus['endpoint'] }
  | { ok: false; stage: EndpointSaveStage; error: string }

export function decodePairingStatus(value: unknown): PairingStatus | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const endpointMode = record.endpointMode
  const hostIdentity = record.hostIdentity
  const configuration = record.configuration
  if (endpointMode !== 'quick' && endpointMode !== 'custom' && endpointMode !== 'relay') return null
  if (typeof hostIdentity !== 'string' || typeof configuration !== 'object' || configuration === null) return null
  const config = configuration as Record<string, unknown>
  if (typeof config.file !== 'string' || typeof config.entryId !== 'string' || typeof config.customEndpointField !== 'string' || typeof config.legacyRelayConfigured !== 'boolean') return null
  let endpoint: PairingStatus['endpoint'] = null
  if (record.endpoint !== null) {
    if (typeof record.endpoint !== 'object') return null
    const raw = record.endpoint as Record<string, unknown>
    if (typeof raw.url !== 'string' || (raw.kind !== 'temporary' && raw.kind !== 'custom' && raw.kind !== 'relay')) return null
    endpoint = { url: raw.url, kind: raw.kind }
  }
  const customEndpointUrl = record.customEndpointUrl
  if (customEndpointUrl !== undefined && customEndpointUrl !== null && typeof customEndpointUrl !== 'string') return null
  const endpointState = record.endpointState ?? (endpoint === null ? 'loading' : 'ready')
  if (endpointState !== 'loading' && endpointState !== 'ready' && endpointState !== 'error') return null
  if (record.endpointError !== undefined && record.endpointError !== null && typeof record.endpointError !== 'string') return null
  return {
    endpoint, endpointMode, hostIdentity, endpointState,
    ...(typeof record.endpointError === 'string' ? { endpointError: record.endpointError } : {}),
    ...(typeof customEndpointUrl === 'string' ? { customEndpointUrl } : {}),
    ...(typeof record.relayUrl === 'string' ? { relayUrl: record.relayUrl } : {}),
    configuration: { file: config.file, entryId: config.entryId, customEndpointField: config.customEndpointField, ...(typeof config.relayEndpointField === 'string' ? { relayEndpointField: config.relayEndpointField } : {}), legacyRelayConfigured: config.legacyRelayConfigured, ...(typeof config.relayConfigured === 'boolean' ? { relayConfigured: config.relayConfigured } : {}) },
  }
}

export function buildEndpointSaveRequest(mode: 'quick' | 'custom' | 'relay', customUrl: string, relayUrl = ''): EndpointSaveRequest | { error: string } {
  if (mode === 'quick') return { endpointMode: 'quick' }
  if (mode === 'relay') {
    const trimmedRelay = relayUrl.trim()
    if (!/^wss:\/\//i.test(trimmedRelay)) return { error: 'relayUrl must be a WSS URL in relay mode' }
    return { endpointMode: 'relay', relayUrl: trimmedRelay }
  }
  const trimmed = customUrl.trim()
  if (trimmed === '') return { error: 'customEndpointUrl is required in custom mode' }
  return { endpointMode: 'custom', customEndpointUrl: trimmed }
}

/** True when the editor does not match the Host's saved Public Endpoint. */
export function endpointDraftDirty(
  mode: 'quick' | 'custom' | 'relay',
  customUrl: string,
  status: Pick<PairingStatus, 'endpointMode' | 'customEndpointUrl' | 'relayUrl'>,
  relayUrl = '',
): boolean {
  if (mode !== status.endpointMode) return true
  if (mode === 'relay') return relayUrl.trim() !== (status.relayUrl ?? '').trim()
  return mode === 'custom' && customUrl.trim() !== (status.customEndpointUrl ?? '').trim()
}

export function decodeEndpointSaveResult(value: unknown): EndpointSaveResult | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (record.ok === true) {
    if (record.endpointMode !== 'quick' && record.endpointMode !== 'custom' && record.endpointMode !== 'relay') return null
    let endpoint: PairingStatus['endpoint'] = null
    if (record.endpoint !== null && record.endpoint !== undefined) {
      if (typeof record.endpoint !== 'object') return null
      const raw = record.endpoint as Record<string, unknown>
      if (typeof raw.url !== 'string' || (raw.kind !== 'temporary' && raw.kind !== 'custom' && raw.kind !== 'relay')) return null
      endpoint = { url: raw.url, kind: raw.kind }
    }
    return { ok: true, endpointMode: record.endpointMode, endpoint }
  }
  if (record.ok !== false || typeof record.error !== 'string') return null
  if (record.stage !== 'endpoint' && record.stage !== 'tls' && record.stage !== 'identity' && record.stage !== 'protocol' && record.stage !== 'capabilities' && record.stage !== 'websocket' && record.stage !== 'relay') return null
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
