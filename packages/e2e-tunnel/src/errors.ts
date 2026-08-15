/** Tunnel error with a machine-readable code. */
export class TunnelError extends Error {
  /** Machine-readable failure reason: 'bad-offer' | 'expired' | 'bad-code' | 'handshake' | 'timeout' | 'closed' | 'seq-violation' | 'too-large' | host-sent codes. */
  readonly code: string
  constructor(code: string, message?: string) {
    super(message ?? 'tunnel: ' + code)
    this.name = 'TunnelError'
    this.code = code
  }
}
