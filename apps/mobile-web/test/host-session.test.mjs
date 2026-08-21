import test from 'node:test'
import assert from 'node:assert/strict'
import { HostSession, shellNeedsPaint } from '../src/host-session.ts'

function selection(rev, extra = {}) {
  return {
    manifest: { rev, entries: [] },
    layout: extra.layout ?? 'narrow',
    compatibility: 'compatible',
    officialLayoutRevision: extra.officialLayoutRevision ?? '1',
  }
}

function prepared(hostId = 'host-a') {
  return {
    profile: { hostId, displayName: hostId, connectionPolicy: 'automatic' },
    offerUrl: 'dsh-mobile://pair#offer=' + hostId,
    loadCredentials: async () => ({ dispose() {} }),
  }
}

function fakeManager() {
  const client = { fetch: async () => new Response('ok') }
  let started = 0
  let stopped = 0
  let armed = 0
  return {
    client,
    stats: () => ({ started, stopped, armed }),
    start() { started += 1 },
    stop() { stopped += 1 },
    async current() { return client },
    armHeartbeat() { armed += 1 },
    async probeNow() {},
  }
}

test('shellNeedsPaint is false for the same Host roster and true when host, rev, or layout change', () => {
  const painted = selection('r1')
  assert.equal(shellNeedsPaint(null, painted, { previousHostId: null, nextHostId: 'host-a' }), true)
  assert.equal(shellNeedsPaint(painted, selection('r1'), { previousHostId: 'host-a', nextHostId: 'host-a' }), false)
  assert.equal(shellNeedsPaint(painted, selection('r2'), { previousHostId: 'host-a', nextHostId: 'host-a' }), true)
  assert.equal(shellNeedsPaint(painted, selection('r1', { layout: 'official' }), { previousHostId: 'host-a', nextHostId: 'host-a' }), true)
  assert.equal(shellNeedsPaint(painted, selection('r1'), { previousHostId: 'host-a', nextHostId: 'host-b' }), true)
})

test('switching Active Host remounts in-shell and never reloads the document', async () => {
  const reloads = []
  const original = globalThis.location
  globalThis.location = { reload: () => reloads.push('reload') }
  const mounts = []
  const managers = []
  const slot = { attach(source) { this.source = source }, async current() { return this.source.current() }, source: null }
  try {
    const session = new HostSession({
      slot,
      createManager(next) {
        const manager = fakeManager()
        managers.push({ hostId: next.profile.hostId, manager })
        return manager
      },
      async injectBoot(_client, next) {
        return selection(next.profile.hostId)
      },
      mount(next) { mounts.push(next.manifest.rev) },
    })
    await session.connect(prepared('host-a'))
    await session.connect(prepared('host-b'))
    assert.deepEqual(mounts, ['host-a', 'host-b'])
    assert.equal(managers[0].manager.stats().stopped, 1)
    assert.equal(managers[1].manager.stats().started, 1)
    assert.equal(managers[1].manager.stats().armed, 1)
    assert.deepEqual(reloads, [])
  } finally {
    globalThis.location = original
  }
})

test('viewport remount reuses the live tunnel and does not reconnect or repaint the same roster', async () => {
  const mounts = []
  let injects = 0
  const manager = fakeManager()
  const slot = { attach(source) { this.source = source }, async current() { return this.source.current() }, source: null }
  const session = new HostSession({
    slot,
    createManager() { return manager },
    async injectBoot() {
      injects += 1
      return selection('live')
    },
    mount(next) { mounts.push(next.manifest.rev) },
  })
  await session.connect(prepared('host-a'))
  await session.remount()
  assert.deepEqual(mounts, ['live'])
  assert.equal(injects, 2)
  assert.equal(manager.stats().started, 1)
  assert.equal(manager.stats().stopped, 0)
})

test('connect paints a cached boot roster before the tunnel is open', async () => {
  const mounts = []
  let release
  const gate = new Promise(resolve => { release = resolve })
  const manager = fakeManager()
  const originalCurrent = manager.current.bind(manager)
  manager.current = async () => { await gate; return originalCurrent() }
  const slot = { attach(source) { this.source = source }, async current() { return this.source.current() }, source: null }
  const session = new HostSession({
    slot,
    createManager() { return manager },
    async hydrateBoot() {
      return selection('r1')
    },
    async injectBoot() {
      return selection('r1')
    },
    mount(next) { mounts.push(next.manifest.rev) },
  })
  const pending = session.connect(prepared('host-a'))
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.deepEqual(mounts, ['r1'])
  release()
  await pending
  assert.deepEqual(mounts, ['r1'])
})

test('a live roster revision change remounts after the cached shell', async () => {
  const mounts = []
  const slot = { attach(source) { this.source = source }, async current() { return this.source.current() }, source: null }
  const session = new HostSession({
    slot,
    createManager() { return fakeManager() },
    async hydrateBoot() { return selection('r1') },
    async injectBoot() { return selection('r2') },
    mount(next) { mounts.push(next.manifest.rev) },
  })
  await session.connect(prepared('host-a'))
  assert.deepEqual(mounts, ['r1', 'r2'])
})

test('reconnecting the same Host rebuilds the tunnel without repainting the shell', async () => {
  const mounts = []
  const managers = []
  const slot = { attach(source) { this.source = source }, async current() { return this.source.current() }, source: null }
  const session = new HostSession({
    slot,
    createManager() {
      const manager = fakeManager()
      managers.push(manager)
      return manager
    },
    async injectBoot() { return selection('r1') },
    mount(next) { mounts.push(next.manifest.rev) },
  })
  await session.connect(prepared('host-a'))
  await session.connect(prepared('host-a'))
  assert.deepEqual(mounts, ['r1'])
  assert.equal(managers[0].stats().stopped, 1)
  assert.equal(managers[1].stats().started, 1)
  assert.equal(managers[1].stats().armed, 1)
})
