import test from 'node:test'
import assert from 'node:assert/strict'
import { HostSession } from '../src/host-session.ts'

const selection = {
  manifest: { rev: 'cached-roster', entries: [] },
  layout: 'narrow',
  compatibility: 'compatible',
}

test('cold cache paints before readiness and remounts once the transport can serve plugin settings', async () => {
  const hostId = 'cold-host'
  let releaseTransport
  const transport = new Promise(resolve => { releaseTransport = resolve })
  const client = { fetch: async () => new Response('ok') }
  const manager = {
    start() {}, stop() {}, armHeartbeat() {}, async probeNow() {},
    async current() { await transport; return client },
  }
  const painted = []
  const hostSession = new HostSession({
    slot: { attach() {}, async current() { return client } },
    createManager() { return manager },
    async hydrateBoot() { return selection },
    async injectBoot() { return selection },
    mount(next, mountedHostId) {
      painted.push({ rev: next.manifest.rev, hostId: mountedHostId })
    },
  })

  const connecting = hostSession.connect({
    profile: { hostId },
    offerUrl: 'offer',
    loadCredentials: async () => ({ dispose() {} }),
  })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(painted, [{ rev: 'cached-roster', hostId }])
  releaseTransport()
  await connecting
  assert.deepEqual(painted, [
    { rev: 'cached-roster', hostId },
    { rev: 'cached-roster', hostId },
  ])
})
