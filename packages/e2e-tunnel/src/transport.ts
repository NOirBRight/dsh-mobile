/**
 * Frame transports for the tunnel session (the seam between the session
 * protocol and the wire). A FrameTransport carries opaque binary frames —
 * post-handshake every frame is a sealed session message; the only string
 * frame that exists is the host's plaintext handshake-phase error.
 *
 * Contract (small on purpose — this is the whole interface a transport
 * must satisfy):
 *  - send(): one binary frame, queued in order. Throwing means the
 *    transport is unusable; the session treats it as fatal.
 *  - onFrame(): single-slot handler (a new registration replaces the old —
 *    the handshake and then the session each own the slot in turn).
 *    Frames are delivered in send order even when payload normalization is
 *    asynchronous (some WebViews deliver Blobs despite binaryType).
 *  - onClose(): single-slot; fires once, after every queued frame has been
 *    delivered. No frames arrive afterwards.
 *  - close(): initiates close. Code/reason are advisory — transports
 *    without close codes (RTCDataChannel) ignore them.
 *
 * Adapters: WsFrameTransport (relay room WebSocket, M3 path) and
 * DataChannelTransport (WebRTC DataChannel; signaling and the surrounding
 * peer setup live outside this package — the channel arrives already open).
 *
 * DataChannel wire format (both peers run this layer; the host-side mirror
 * uses the same exported codec). RTCDataChannel application messages must
 * stay ≤ 60 KiB, so every message carries a small header and large frames
 * are fragmented — fragmentation is a transport detail; FrameTransport
 * callers only ever see whole frames:
 *
 *   whole frame:  tag(1)=0x00 || frameBytes                      (frame ≤ 61439 B)
 *   fragment:     tag(1)=0x01 || frameId(u16le) || offset(u32le)
 *                 || total(u32le) || payload                     (message ≤ 61440 B)
 *
 * At most one fragmented frame may be in flight per direction; fragments
 * arrive in exact offset order (the channel is reliable+ordered, so any
 * gap means a broken or malicious peer). Violations are protocol errors:
 * the transport closes.
 */
import { TunnelError } from './errors.ts'

/** The binary frame pipe a TunnelSession rides. See the module header for the contract. */
export interface FrameTransport {
  send(frame: Uint8Array): void
  onFrame(cb: (frame: Uint8Array | string) => void): void
  onClose(cb: () => void): void
  close(code?: number, reason?: string): void
}

// ── DataChannel fragmentation codec ────────────────────────────────────────

/** Hard cap on one RTCDataChannel application message (SCTP interop insurance). */
export const MAX_MESSAGE_BYTES = 60 * 1024
/**
 * Defensive cap on one reassembled frame. Session plaintext is capped at
 * 200 KiB by the tunnel protocol, so honest frames are far smaller; this
 * bound exists to stop a peer from forcing unbounded reassembly buffers.
 */
export const MAX_FRAME_BYTES = 16 * 1024 * 1024

const TAG_WHOLE = 0x00
const TAG_FRAGMENT = 0x01
/** tag(1) + frameId(2) + offset(4) + total(4). */
const FRAGMENT_HEADER_BYTES = 11
const FRAGMENT_PAYLOAD_BYTES = MAX_MESSAGE_BYTES - FRAGMENT_HEADER_BYTES

/**
 * Split one frame into ≤60 KiB application messages (pure).
 * @param frame the whole tunnel frame.
 * @param frameId sender-side rolling id (u16); only meaningful for fragmented frames.
 * @returns one or more wire messages, each ≤ MAX_MESSAGE_BYTES.
 */
export function fragmentFrame(frame: Uint8Array, frameId: number): Uint8Array[] {
  if (frame.length <= MAX_MESSAGE_BYTES - 1) {
    const message = new Uint8Array(frame.length + 1)
    message[0] = TAG_WHOLE
    message.set(frame, 1)
    return [message]
  }
  const out: Uint8Array[] = []
  for (let offset = 0; offset < frame.length; offset += FRAGMENT_PAYLOAD_BYTES) {
    const slice = frame.subarray(offset, Math.min(offset + FRAGMENT_PAYLOAD_BYTES, frame.length))
    const message = new Uint8Array(FRAGMENT_HEADER_BYTES + slice.length)
    const view = new DataView(message.buffer)
    message[0] = TAG_FRAGMENT
    view.setUint16(1, frameId, true)
    view.setUint32(3, offset, true)
    view.setUint32(7, frame.length, true)
    message.set(slice, FRAGMENT_HEADER_BYTES)
    out.push(message)
  }
  return out
}

/**
 * Strict reassembler for the wire format above. At most one frame in
 * flight; fragments must continue the in-flight frame at the exact next
 * offset. Any violation throws TunnelError('bad-fragment') and the
 * reassembler is unusable afterwards — the owning transport closes.
 */
export class FrameReassembler {
  private pending: { id: number; total: number; buf: Uint8Array; received: number } | null = null
  private broken = false

  /**
   * @param message one received application message (≤ MAX_MESSAGE_BYTES).
   * @returns the complete frame, or null while the frame is incomplete.
   * @throws TunnelError 'bad-fragment' on any format/order/size violation.
   */
  push(message: Uint8Array): Uint8Array | null {
    if (this.broken) throw new TunnelError('bad-fragment', 'reassembler is broken')
    try {
      return this.accept(message)
    } catch (error) {
      this.broken = true
      throw error
    }
  }

  private accept(message: Uint8Array): Uint8Array | null {
    if (message.length === 0) throw new TunnelError('bad-fragment', 'empty message')
    if (message.length > MAX_MESSAGE_BYTES) throw new TunnelError('bad-fragment', 'message exceeds 60 KiB')
    const tag = message[0]
    if (tag === TAG_WHOLE) {
      if (this.pending !== null) throw new TunnelError('bad-fragment', 'whole frame during fragmented frame')
      return message.subarray(1)
    }
    if (tag !== TAG_FRAGMENT) throw new TunnelError('bad-fragment', 'unknown message tag ' + tag)
    if (message.length <= FRAGMENT_HEADER_BYTES) throw new TunnelError('bad-fragment', 'fragment with empty payload')
    const view = new DataView(message.buffer, message.byteOffset, message.byteLength)
    const id = view.getUint16(1, true)
    const offset = view.getUint32(3, true)
    const total = view.getUint32(7, true)
    if (total === 0 || total > MAX_FRAME_BYTES) throw new TunnelError('bad-fragment', 'frame total out of range: ' + total)
    const payload = message.subarray(FRAGMENT_HEADER_BYTES)
    if (offset + payload.length > total) throw new TunnelError('bad-fragment', 'fragment overruns frame')
    let pending = this.pending
    if (pending === null) {
      if (offset !== 0) throw new TunnelError('bad-fragment', 'fragment stream does not start at offset 0')
      pending = this.pending = { id, total, buf: new Uint8Array(total), received: 0 }
    } else if (id !== pending.id || offset !== pending.received) {
      throw new TunnelError('bad-fragment', 'fragment out of order')
    }
    pending.buf.set(payload, offset)
    pending.received += payload.length
    if (pending.received === pending.total) {
      this.pending = null
      return pending.buf
    }
    return null
  }
}

/**
 * Normalize a message payload to bytes or text. binaryType='arraybuffer'
 * is a HINT some WebViews (WeChat/TBS among them) ignore and deliver Blobs
 * anyway; slicing those as ArrayBuffer ends in tweetnacl size errors.
 */
async function frameData(data: unknown): Promise<Uint8Array | string> {
  if (typeof data === 'string') return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (typeof Blob !== 'undefined' && data instanceof Blob) return new Uint8Array(await data.arrayBuffer())
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  throw new TunnelError('handshake', 'unsupported frame payload type')
}

/** Shared ordered-delivery core: normalizes payloads through a promise queue so seq order survives async Blob reads. */
abstract class QueuedTransport implements FrameTransport {
  private frameHandler: ((frame: Uint8Array | string) => void) | null = null
  private closeHandler: (() => void) | null = null
  private queue: Promise<void> = Promise.resolve()

  /** Enqueue one raw payload; the handler fires after every earlier payload. */
  protected ingest(data: unknown): void {
    this.queue = this.queue.then(async () => {
      const frame = await frameData(data).catch(() => null)
      if (frame === null) return
      const out = this.process(frame)
      if (out !== null) this.frameHandler?.(out)
    }).catch(() => {})
  }

  /**
   * Transform one normalized payload into a deliverable frame.
   * @returns the frame to deliver, or null to swallow it (incomplete fragment).
   */
  protected process(frame: Uint8Array | string): Uint8Array | string | null {
    return frame
  }

  /** Fire the close handler once all queued frames have been delivered. */
  protected emitClose(): void {
    void this.queue.then(() => this.closeHandler?.())
  }

  onFrame(cb: (frame: Uint8Array | string) => void): void {
    this.frameHandler = cb
  }

  onClose(cb: () => void): void {
    this.closeHandler = cb
  }

  abstract send(frame: Uint8Array): void
  abstract close(code?: number, reason?: string): void
}

/** Relay-room WebSocket adapter (the M3 wire). Construct once the socket exists; open-wait stays with the caller. */
export class WsFrameTransport extends QueuedTransport {
  private readonly ws: WebSocket

  constructor(ws: WebSocket) {
    super()
    this.ws = ws
    ws.addEventListener('message', (ev) => this.ingest(ev.data))
    ws.addEventListener('close', () => this.emitClose())
    ws.addEventListener('error', () => {}) // close always follows; the close handler owns the bookkeeping
  }

  send(frame: Uint8Array): void {
    // FrameTransport accepts any view; WebSocket wants a BufferSource over a
    // real ArrayBuffer (TS 5.7+ generic Uint8Array). Session frames come from
    // concat() and are always fresh exact arrays.
    this.ws.send(frame as Uint8Array<ArrayBuffer>)
  }

  close(code?: number, reason?: string): void {
    this.ws.close(code, reason)
  }
}

/**
 * Structural RTCDataChannel surface the adapter relies on. Declared here
 * (rather than using the DOM RTCDataChannel type) so the package stays
 * testable in Node and tolerant of WebView quirks; a real RTCDataChannel
 * satisfies this structurally.
 */
export interface DataChannelLike {
  binaryType: string
  send(data: Uint8Array | ArrayBuffer): void
  close(): void
  addEventListener(type: string, cb: (ev: MessageEvent) => void): void
}

/**
 * WebRTC DataChannel adapter. The channel must already be open and
 * negotiated reliable+ordered (the default): the session protocol numbers
 * every frame and closes on a seq gap, so reordering is fatal — the same
 * assumption the single relay WebSocket provided. DTLS secures the wire,
 * but the NaCl handshake/session layer on top is unchanged: the signaling
 * path stays untrusted.
 *
 * Fragmentation is transparent: send() splits frames into ≤60 KiB
 * application messages and incoming messages are reassembled before the
 * FrameTransport handler ever runs (see the wire format at the top of this
 * file). A malformed fragment stream is a protocol error and closes the
 * transport.
 */
export class DataChannelTransport extends QueuedTransport {
  private readonly channel: DataChannelLike
  private readonly reassembler = new FrameReassembler()
  private nextFrameId = 0

  constructor(channel: DataChannelLike) {
    super()
    this.channel = channel
    channel.binaryType = 'arraybuffer' // a hint, as above; ingest() normalizes regardless
    channel.addEventListener('message', (ev) => this.ingest(ev.data))
    channel.addEventListener('close', () => this.emitClose())
  }

  send(frame: Uint8Array): void {
    const id = this.nextFrameId
    if (frame.length > MAX_MESSAGE_BYTES - 1) this.nextFrameId = (this.nextFrameId + 1) & 0xffff
    for (const message of fragmentFrame(frame, id)) this.channel.send(message)
  }

  protected process(frame: Uint8Array | string): Uint8Array | string | null {
    if (typeof frame === 'string') return frame // plaintext handshake-phase error frames carry no header
    try {
      return this.reassembler.push(frame)
    } catch {
      this.close() // malformed fragment stream: protocol error, tear the transport down
      return null
    }
  }

  close(): void {
    this.channel.close() // RTCDataChannel close carries no code/reason
  }
}
