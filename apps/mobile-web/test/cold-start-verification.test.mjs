import test from 'node:test'
import assert from 'node:assert/strict'
import { HostSession } from '../src/host-session.ts'
import { prepareSessionHydration } from '../src/session-hydration.ts'

class PreloadedDatabase {
  constructor(records) { this.records = records }
  async readList(hostId) { return this.records.find(record => record.kind === 'list' && record.hostId === hostId) }
  async readWindows(hostId) { return this.records.filter(record => record.kind === 'window' && record.hostId === hostId) }
  async writeList() {}
  async writeWindow() {}
  async writeMigration() {}
  close() {}
}

const selection = {
  manifest: { rev: 'cached-roster', entries: [] },
  layout: 'narrow',
  compatibility: 'compatible',
  enhancement: { status: 'enabled', officialRuntimeRevision: 'verified' },
}

test('cold cache paints Host-scoped list and selected history before transport readiness', async () => {
  const hostId = 'cold-host'
  const sessionId = 'selected-session'
  const event = { type: 'user/message', seq: 1, time: 10, data: { text: 'cached' } }
  const database = new PreloadedDatabase([
    {
      key: 'dsh-mobile:cold-host:sessions-list:v2', kind: 'list', version: 2, hostId,
      entries: [{ sessionId, title: 'Cached session', updatedAt: 10, blank: false }],
    },
    {
      key: 'dsh-mobile:cold-host:history:selected-session:v2', kind: 'window', version: 2,
      hostId, sessionId, window: { entries: [{ event }], hasMore: true },
    },
  ])
  const hydration = await prepareSessionHydration({ hostId, database })
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
      painted.push({
        rev: next.manifest.rev,
        hostId: mountedHostId,
        list: hydration.adapter.readList(),
        window: hydration.adapter.readWindow(sessionId),
      })
    },
  })

  const connecting = hostSession.connect({ profile: { hostId }, offerUrl: 'offer', loadCredentials: async () => ({ dispose() {} }) })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(painted, [{
    rev: 'cached-roster', hostId,
    list: [{ sessionId, title: 'Cached session', updatedAt: 10, blank: false }],
    window: { entries: [{ event }], hasMore: true },
  }])
  releaseTransport()
  await connecting
  assert.equal(painted.length, 1)
})
