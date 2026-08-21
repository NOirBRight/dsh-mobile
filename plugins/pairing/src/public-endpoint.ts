/** Public Endpoint parsing and provider-neutral staged external validation. */
import { WebSocket } from 'ws'
import type { PublicEndpointCapabilities } from './pairing.ts'

export interface EndpointFetchResponse { ok: boolean; status: number; json(): Promise<unknown> }
export interface EndpointWebSocket { close(): void }
export interface CustomEndpointAdapters {
  fetch(url: string): Promise<EndpointFetchResponse>
  openWebSocket(url: string): Promise<EndpointWebSocket>
}
export type CustomEndpointCheck =
  | { ok: true; stage: 'ready'; hostIdentity: string; capabilities: PublicEndpointCapabilities }
  | { ok: false; stage: 'endpoint' | 'tls' | 'identity' | 'protocol' | 'capabilities' | 'websocket'; error: string }

export function validateCustomEndpoint(value: string): string {
  let url: URL
  try { url = new URL(value) } catch { throw new Error('Custom Endpoint must be an HTTPS URL') }
  if (url.protocol !== 'https:') throw new Error('Custom Endpoint must use HTTPS')
  if (url.username !== '' || url.password !== '') throw new Error('Custom Endpoint must not contain credentials')
  if (url.search !== '' || url.hash !== '') throw new Error('Custom Endpoint must not contain query or fragment data')
  return url.toString().replace(/\/$/, '')
}

function capabilities(value: unknown): PublicEndpointCapabilities | null {
  if (value === null || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  if (['browser', 'direct', 'tunnel', 'endpointRefresh'].some(key => typeof candidate[key] !== 'boolean')) return null
  return candidate as unknown as PublicEndpointCapabilities
}

export async function checkCustomEndpoint(value: string, adapters: CustomEndpointAdapters): Promise<CustomEndpointCheck> {
  let endpoint: string
  try { endpoint = validateCustomEndpoint(value) } catch (error) { return { ok: false, stage: 'endpoint', error: (error as Error).message } }
  let response: EndpointFetchResponse
  try { response = await adapters.fetch(endpoint + '/.well-known/dsh-mobile') } catch (error) { return { ok: false, stage: 'tls', error: String((error as Error).message ?? error) } }
  if (!response.ok) return { ok: false, stage: 'tls', error: 'Gateway health returned HTTP ' + response.status }
  let body: unknown
  try { body = await response.json() } catch { return { ok: false, stage: 'identity', error: 'Gateway health response was not JSON' } }
  if (body === null || typeof body !== 'object') return { ok: false, stage: 'identity', error: 'Gateway identity is missing' }
  const record = body as Record<string, unknown>
  if (record.protocol !== 1) return { ok: false, stage: 'protocol', error: 'unsupported Gateway protocol ' + String(record.protocol) }
  if (typeof record.hostIdentity !== 'string') return { ok: false, stage: 'identity', error: 'Gateway identity is missing' }
  const caps = capabilities(record.capabilities)
  if (caps === null) return { ok: false, stage: 'capabilities', error: 'Gateway capabilities are invalid' }
  if (caps.browser !== false || caps.tunnel !== true || caps.endpointRefresh !== true) {
    return { ok: false, stage: 'capabilities', error: 'Gateway must advertise APK-only tunnel capabilities' }
  }
  const wsUrl = new URL(endpoint)
  wsUrl.protocol = 'wss:'
  wsUrl.pathname = wsUrl.pathname.replace(/\/$/, '') + '/signal/check'
  let socket: EndpointWebSocket
  try { socket = await adapters.openWebSocket(wsUrl.toString()) } catch (error) { return { ok: false, stage: 'websocket', error: String((error as Error).message ?? error) } }
  socket.close()
  return { ok: true, stage: 'ready', hostIdentity: record.hostIdentity, capabilities: caps }
}

/** Production adapters for Host-side Custom Endpoint checks. Tests inject their own. */
export function createNodeCustomEndpointAdapters(timeoutMs = 8_000): CustomEndpointAdapters {
  return {
    async fetch(url) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const response = await globalThis.fetch(url, { signal: controller.signal })
        return { ok: response.ok, status: response.status, json: () => response.json() }
      } finally {
        clearTimeout(timer)
      }
    },
    openWebSocket(url) {
      return new Promise((resolve, reject) => {
        const socket = new WebSocket(url)
        const timer = setTimeout(() => { socket.terminate(); reject(new Error('WebSocket upgrade timed out')) }, timeoutMs)
        socket.once('open', () => { clearTimeout(timer); resolve({ close() { socket.close() } }) })
        socket.once('error', error => { clearTimeout(timer); reject(error) })
      })
    },
  }
}
