/** Tunnel error with a machine-readable code. */
export class TunnelError extends Error {
  /** Machine-readable failure reason: 'bad-offer' | 'expired' | 'bad-code' | 'handshake' | 'timeout' | 'closed' | 'seq-violation' | 'too-large' | host-sent codes. */
  readonly code: string
  /** Optional structured context (HTTP body limits, etc.). */
  readonly details?: TunnelErrorDetails
  constructor(code: string, message?: string, details?: TunnelErrorDetails) {
    super(message ?? 'tunnel: ' + code)
    this.name = 'TunnelError'
    this.code = code
    if (details !== undefined) this.details = details
  }
}

export interface TunnelErrorDetails {
  direction?: 'request' | 'response'
  maxHttpBodyBytes?: number
  actualHttpBodyBytes?: number
}

/** tunnel-protocol.md section 4: advertised HTTP body cap. */
export const DEFAULT_MAX_HTTP_BODY_BYTES = 8 * 1024 * 1024
