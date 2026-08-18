import test from 'node:test'
import assert from 'node:assert/strict'
import { RTCPeerConnection } from 'werift'
import { acceptDirectOffer } from '../src/webrtc-host.ts'

const deadline = (promise, ms = 10_000) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error('deadline exceeded')), ms)),
])

test('answers a direct data-channel offer without a relay candidate', async () => {
  const client = new RTCPeerConnection({ iceServers: [] })
  const local = client.createDataChannel('dsh-tunnel', { ordered: true })
  await client.setLocalDescription(await client.createOffer())

  const host = await acceptDirectOffer(client.localDescription, { iceServers: [] })
  await client.setRemoteDescription(host.answer)
  const remote = await deadline(host.channel)
  await deadline(new Promise(resolve => {
    if (local.readyState === 'open') resolve(undefined)
    else local.onopen = () => resolve(undefined)
  }))
  const received = deadline(new Promise(resolve => remote.onMessage.subscribe(resolve)))
  local.send(Buffer.from('p2p-only'))
  assert.equal(String(await received), 'p2p-only')

  await host.close()
  await client.close()
})

test('rejects TURN configuration so there is no hidden server fallback', async () => {
  await assert.rejects(
    () => acceptDirectOffer({ type: 'offer', sdp: 'x' }, {
      iceServers: [{ urls: 'turn:personal.example:3478', username: 'x', credential: 'y' }],
    }),
    /TURN is not allowed/,
  )
})
