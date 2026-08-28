import { b64decode, b64encode, utf8Decode, utf8Encode } from './bytes.ts'
import { TunnelError } from './errors.ts'
import type { TunnelSession } from './client.ts'

type Listener = (ev: Record<string, unknown>) => void

/**
 * Minimal browser-WebSocket facade over one tunnel multiplex channel
 * (ws-open/ws-ack/ws-msg/ws-close). Covers exactly what the upstream browser
 * carrier uses: readyState + constants, send, close, on*-properties,
 * addEventListener/removeEventListener (with { once }).
 */
export class TunnelWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  readonly CONNECTING = 0
  readonly OPEN = 1
  readonly CLOSING = 2
  readonly CLOSED = 3

  onopen: Listener | null = null
  onmessage: Listener | null = null
  onerror: Listener | null = null
  onclose: Listener | null = null
  /** Accepted for interface parity; payloads are always delivered as strings. */
  binaryType: string = 'arraybuffer'

  readonly id: string
  private ready = 0
  private listeners = new Map<string, { cb: Listener; once: boolean }[]>()

  private readonly session: TunnelSession
  readonly path: string

  constructor(session: TunnelSession, path: string) {
    this.session = session
    this.path = path
    this.id = session.mintId()
    session.registerSocket(this.id, this)
    try {
      session.send({ t: 'ws-open', id: this.id, path })
    } catch (error) {
      // Listeners attach after construction; surface the failure asynchronously.
      queueMicrotask(() => this.fail(String(error), 1006))
    }
  }

  get readyState(): number {
    return this.ready
  }

  addEventListener(type: string, cb: Listener, options?: { once?: boolean }): void {
    const list = this.listeners.get(type) ?? []
    list.push({ cb, once: options?.once === true })
    this.listeners.set(type, list)
  }

  removeEventListener(type: string, cb: Listener): void {
    const list = this.listeners.get(type)
    if (!list) return
    const next = list.filter((entry) => entry.cb !== cb)
    if (next.length === 0) this.listeners.delete(type)
    else this.listeners.set(type, next)
  }

  /** Send one ws-msg frame while preserving WebSocket text/binary type. */
  send(data: string | ArrayBuffer | Uint8Array): void {
    if (this.ready !== 1) throw new TunnelError('closed', 'WebSocket is not open')
    const binary = typeof data !== 'string'
    const bytes = typeof data === 'string' ? utf8Encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data)
    this.session.send({ t: 'ws-msg', id: this.id, data: b64encode(bytes), binary })
  }

  close(code = 1000, reason = ''): void {
    if (this.ready === 2 || this.ready === 3) return
    this.ready = 2
    try {
      this.session.send({ t: 'ws-close', id: this.id, code, reason })
    } catch {
      this.session.dropSocket(this.id) // tunnel already gone; close arrives via tunnelClosed
    }
    this.settle(3, code, reason)
  }

  /** @internal host acknowledged the loopback WebSocket. */
  onAck(): void {
    if (this.ready !== 0) return
    this.ready = 1
    this.emit('open', {})
  }

  /** @internal host refused the loopback WebSocket. */
  onErr(message: string): void {
    this.fail(message, 1006)
  }

  /** @internal host to client payload with original WebSocket message type. */
  onMsg(dataB64: string, binary = false): void {
    if (this.ready !== 1) return
    const bytes = b64decode(dataB64)
    const data = binary
      ? this.binaryType === 'arraybuffer' ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes
      : utf8Decode(bytes)
    this.emit('message', { data })
  }

  /** @internal host closed its side. */
  onHostClose(code?: number, reason?: string): void {
    this.settle(3, code ?? 1000, reason ?? '')
  }

  /** @internal the whole tunnel dropped. */
  tunnelClosed(): void {
    this.settle(3, 1006, 'tunnel closed')
  }

  private fail(message: string, code: number): void {
    this.emit('error', { message })
    this.settle(3, code, message)
  }

  private settle(state: number, code: number, reason: string): void {
    if (this.ready === 3) return
    this.ready = state
    if (state === 3) {
      this.session.dropSocket(this.id)
      this.emit('close', { code, reason })
    }
  }

  private emit(type: string, event: Record<string, unknown>): void {
    const ev = { type, ...event }
    const prop = type === 'open' ? this.onopen : type === 'message' ? this.onmessage : type === 'error' ? this.onerror : this.onclose
    if (prop) prop(ev)
    const list = this.listeners.get(type)
    if (!list) return
    for (const entry of [...list]) {
      entry.cb(ev)
      if (entry.once) this.removeEventListener(type, entry.cb)
    }
  }
}

/** Structural WebSocket surface the upstream carrier relies on. */
export type WebSocketLike = TunnelWebSocket
