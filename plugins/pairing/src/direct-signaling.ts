/** Signaling-only host coordinator. No DSH application frame crosses this socket. */
import type { RTCDataChannel } from 'werift'
import { decodeSignal, encodeSignal } from '@dsh-mobile/e2e-tunnel'
import { acceptDirectOffer, type DirectHostPeer, type DirectIceServer, type DirectSessionDescription } from './webrtc-host.ts'

interface SignalingSocket {
  on(type: 'message', listener: (data: unknown, isBinary: boolean) => void): unknown
  send(data: string): void
  close(): void
}

export interface DirectSignalingOptions {
  iceServers: DirectIceServer[]
  onChannel(channel: RTCDataChannel): void
  onError?: (error: Error) => void
}

export interface DirectSignalingGate { close(): void }

export function encodeSignalDescription(kind: 'offer' | 'answer', description: DirectSessionDescription): string {
  return encodeSignal({ kind, description })
}

function decodeOffer(raw: unknown, isBinary: boolean): DirectSessionDescription {
  if (isBinary) throw new Error('direct signaling expected a text envelope')
  const text = typeof raw === 'string'
    ? raw
    : Array.isArray(raw)
      ? Buffer.concat(raw as Uint8Array[]).toString()
      : raw instanceof ArrayBuffer
        ? Buffer.from(new Uint8Array(raw)).toString()
        : ArrayBuffer.isView(raw)
          ? Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString()
          : (() => { throw new Error('invalid direct signaling payload') })()
  const signal = decodeSignal(text)
  if (signal === null || signal.kind !== 'offer' || signal.description.type !== 'offer') {
    throw new Error('direct signaling expected an offer')
  }
  return { type: 'offer', sdp: signal.description.sdp }
}

/** Attach one persistent host room socket; every offer replaces the prior peer. */
export function attachDirectSignaling(
  socket: SignalingSocket,
  options: DirectSignalingOptions,
): DirectSignalingGate {
  let closed = false
  let generation = 0
  let peer: DirectHostPeer | null = null

  const fail = (error: unknown): void => {
    options.onError?.(error instanceof Error ? error : new Error(String(error)))
  }
  const negotiate = async (raw: unknown, isBinary: boolean): Promise<void> => {
    const ownGeneration = ++generation
    const offer = decodeOffer(raw, isBinary)
    const next = await acceptDirectOffer(offer, { iceServers: options.iceServers })
    if (closed || ownGeneration !== generation) { await next.close(); return }
    const previous = peer
    peer = next
    if (previous !== null) await previous.close()
    socket.send(encodeSignalDescription('answer', next.answer))
    const channel = await next.channel
    if (!closed && ownGeneration === generation) options.onChannel(channel)
  }

  socket.on('message', (data, isBinary) => { void negotiate(data, isBinary).catch(fail) })
  return {
    close() {
      if (closed) return
      closed = true
      generation++
      socket.close()
      if (peer !== null) void peer.close()
      peer = null
    },
  }
}
