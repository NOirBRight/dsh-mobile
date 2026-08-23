/** Validate, check, and persist Host Public Endpoint mode without editing YAML. */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { GatewayEndpoint } from './gateway.ts'
import { checkCustomEndpoint, checkRelayEndpoint, validateCustomEndpoint, validateRelayEndpoint, type CustomEndpointAdapters, type CustomEndpointCheck } from './public-endpoint.ts'

export type EndpointMode = 'quick' | 'custom' | 'relay'

export interface PublicEndpointSelection {
  endpointMode: EndpointMode
  customEndpointUrl?: string
  relayUrl?: string
}

export type PublicEndpointApplyResult =
  | { ok: true; endpointMode: 'quick' }
  | { ok: true; endpointMode: 'custom'; endpoint: GatewayEndpoint; check: Extract<CustomEndpointCheck, { ok: true }> }
  | { ok: true; endpointMode: 'relay'; endpoint: GatewayEndpoint }
  | { ok: false; stage: Exclude<CustomEndpointCheck['stage'], 'ready'> | 'relay'; error: string }

export function parseEndpointSelection(value: unknown): PublicEndpointSelection | { error: string } {
  if (typeof value !== 'object' || value === null) return { error: 'endpoint selection must be an object' }
  const record = value as Record<string, unknown>
  if (record.endpointMode === 'quick') {
    return { endpointMode: 'quick', ...(typeof record.customEndpointUrl === 'string' && record.customEndpointUrl !== '' ? { customEndpointUrl: record.customEndpointUrl } : {}) }
  }
  if (record.endpointMode === 'custom') {
    if (typeof record.customEndpointUrl !== 'string' || record.customEndpointUrl.trim() === '') return { error: 'customEndpointUrl is required in custom mode' }
    return { endpointMode: 'custom', customEndpointUrl: record.customEndpointUrl.trim() }
  }
  if (record.endpointMode === 'relay') {
    if (typeof record.relayUrl !== 'string' || record.relayUrl.trim() === '') return { error: 'relayUrl is required in relay mode' }
    return { endpointMode: 'relay', relayUrl: record.relayUrl.trim() }
  }
  return { error: 'endpointMode must be quick, custom, or relay' }
}

export async function applyPublicEndpointSelection(
  selection: PublicEndpointSelection,
  options: { hostIdentity: string; adapters: CustomEndpointAdapters; check?: typeof checkCustomEndpoint; relayCheck?: typeof checkRelayEndpoint },
): Promise<PublicEndpointApplyResult> {
  if (selection.endpointMode === 'quick') return { ok: true, endpointMode: 'quick' }
  if (selection.endpointMode === 'relay') {
    let relayUrl: string
    try { relayUrl = validateRelayEndpoint(selection.relayUrl as string) } catch (error) { return { ok: false, stage: 'endpoint', error: (error as Error).message } }
    const check = await (options.relayCheck ?? checkRelayEndpoint)(relayUrl, options.adapters)
    if (!check.ok) return check
    return { ok: true, endpointMode: 'relay', endpoint: { url: relayUrl, kind: 'relay' } }
  }
  const check = await (options.check ?? checkCustomEndpoint)(selection.customEndpointUrl as string, options.adapters)
  if (!check.ok) return check
  const known = new Set([check.hostIdentity, ...check.hostIdentities])
  if (!known.has(options.hostIdentity)) {
    return { ok: false, stage: 'identity', error: 'endpoint Host Identity does not match this Host' }
  }
  return { ok: true, endpointMode: 'custom', endpoint: { url: validateCustomEndpoint(selection.customEndpointUrl as string), kind: 'custom' }, check }
}

export function loadPublicEndpointOverlay(path: string): PublicEndpointSelection | null {
  let raw: string
  try { raw = readFileSync(path, 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new Error('dsh-mobile-pairing: unreadable public endpoint overlay ' + path + ': ' + String(error))
  }
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch (error) {
    throw new Error('dsh-mobile-pairing: unreadable public endpoint overlay ' + path + ': ' + String(error))
  }
  const selection = parseEndpointSelection(parsed)
  if ('error' in selection) throw new Error('dsh-mobile-pairing: invalid public endpoint overlay ' + path + ': ' + selection.error)
  return selection
}

export function savePublicEndpointOverlay(path: string, selection: PublicEndpointSelection): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = path + '.' + process.pid + '.tmp'
  writeFileSync(tmp, JSON.stringify(selection, null, 2))
  renameSync(tmp, path)
}
