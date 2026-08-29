// In-memory DataChannel pair implementing the DataChannelLike surface
// (binaryType, send, close, addEventListener). Delivers payloads as
// ArrayBuffer, or as Blob when the RECEIVER has blobMode set (exercises the
// transport's async normalization queue — WeChat/TBS-style WebViews ignore
// binaryType). wireSizes, when set on the SENDER, records every application
// message size so fragmentation tests can assert the ≤60 KiB rule.
export class FakeDataChannel {
  constructor() {
    this.binaryType = 'arraybuffer'
    this.listeners = { message: [], close: [], open: [], error: [] }
    this.peer = null
    this.closed = false
    this.blobMode = false
    this.wireSizes = null
  }

  /** Fire the 'open' event (FakePeerConnection drives this on remote-answer). */
  fireOpen() {
    for (const cb of this.listeners.open) cb({})
  }

  static pair() {
    const a = new FakeDataChannel()
    const b = new FakeDataChannel()
    a.peer = b
    b.peer = a
    return [a, b]
  }

  addEventListener(type, cb) {
    this.listeners[type].push(cb)
  }

  send(data) {
    if (this.closed) throw new Error('send on closed channel')
    const bytes = (data instanceof Uint8Array ? data : new Uint8Array(data)).slice()
    if (this.wireSizes) this.wireSizes.push(bytes.length)
    const peer = this.peer
    queueMicrotask(() => {
      // In-flight frames flush even if the far end has since closed (a
      // reliable channel drains before the close completes).
      const payload = peer.blobMode ? new Blob([bytes]) : bytes.buffer
      for (const cb of peer.listeners.message) cb({ data: payload })
    })
  }

  close() {
    if (this.closed) return
    this.closed = true
    const peer = this.peer
    queueMicrotask(() => {
      for (const cb of this.listeners.close) cb({})
      if (peer && !peer.closed) {
        peer.closed = true
        for (const cb of peer.listeners.close) cb({})
      }
    })
  }
}
