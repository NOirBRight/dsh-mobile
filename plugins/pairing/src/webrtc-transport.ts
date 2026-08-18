/** Host adapter from werift's event API to the shared fragmented frame wire. */
import type { RTCDataChannel } from 'werift'
import { DataChannelTransport, type DataChannelLike } from '@dsh-mobile/e2e-tunnel'
import type { HostFrameTransport } from './host-transport.ts'

function adaptWeriftChannel(channel: RTCDataChannel): DataChannelLike {
  return {
    binaryType: 'arraybuffer',
    send(data) { channel.send(Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data)) },
    close() { channel.close() },
    addEventListener(type, cb) {
      if (type === 'message') {
        channel.onMessage.subscribe(data => cb({ data } as MessageEvent))
      } else if (type === 'close') {
        channel.stateChanged.subscribe(state => {
          if (state === 'closed') cb({} as MessageEvent)
        })
      }
      // werift reports transport failure through the same closed state.
    },
  }
}

/** Uses the exact client codec; no WebRTC message can exceed 60 KiB. */
export class WeriftDataChannelTransport implements HostFrameTransport {
  private readonly channel: RTCDataChannel
  private readonly transport: DataChannelTransport

  constructor(channel: RTCDataChannel) {
    this.channel = channel
    this.transport = new DataChannelTransport(adaptWeriftChannel(channel))
  }

  send(frame: Uint8Array | string): void {
    if (typeof frame === 'string') this.channel.send(frame)
    else this.transport.send(frame)
  }

  onFrame(cb: (frame: Uint8Array | string) => void): void { this.transport.onFrame(cb) }
  onClose(cb: () => void): void { this.transport.onClose(cb) }
  close(): void { this.transport.close() }
}
