/** Validate, check, and persist Host Public Endpoint mode without editing YAML. */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { GatewayEndpoint } from './gateway.ts'
import { checkCustomEndpoint, validateCustomEndpoint, type CustomEndpointAdapters, type CustomEndpointCheck } from './public-endpoint.ts'

export type EndpointMode = 'quick' | 'custom'

export interface PublicEndpointSelection {
  endpointMode: EndpointMode
  customEndpointUrl?: string
}

export type PublicEndpointApplyResult =
  | { ok: true; endpointMode: 'quick' }
  | { ok: true; endpointMode: 'custom'; endpoint: GatewayEndpoint; check: Extract<CustomEndpointCheck, { ok: true }> }
  | { ok: false; stage: Exclude<CustomEndpointCheck['stage'], 'ready'> | 'identity'; error: string }

export function parseEndpointSelection(value: unknown): PublicEndpointSelection | { error: string } {
  if (typeof value !== 'object' || value === null) return { error: 'endpoint selection must be an object' }
  const record = value as Record<string, unknown>
  if (record.endpointMode === 'quick') {
    return { endpointMode: 'quick', ...(typeof record.customEndpointUrl === 'string' && record.customEndpointUrl !== '' ? { customEndpointUrl: record.customEndpointUrl } : {}) }
  }
  if (record.endpointMode !== 'custom') return { error: 'endpointMode must be quick or custom' }
  if (typeof record.customEndpointUrl !== 'string' || record.customEndpointUrl.trim() === '') {
    return { error: 'customEndpointUrl is required in custom mode' }
  }
  return { endpointMode: 'custom', customEndpointUrl: record.customEndpointUrl.trim() }
}

export async function applyPublicEndpointSelection(
  selection: PublicEndpointSelection,
  options: { hostIdentity: string; adapters: CustomEndpointAdapters; check?: typeof checkCustomEndpoint },
): Promise<PublicEndpointApplyResult> {
  if (selection.endpointMode === 'quick') return { ok: true, endpointMode: 'quick' }
  const check = await (options.check ?? checkCustomEndpoint)(selection.customEndpointUrl as string, options.adapters)
  if (!check.ok) return check
  if (check.hostIdentity !== options.hostIdentity) {
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
