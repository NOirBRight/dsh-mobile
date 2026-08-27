import test from 'node:test'
import assert from 'node:assert/strict'
import { TunnelError } from '@dsh-mobile/e2e-tunnel'
import { HostSession, isHostSessionStoppedError, isTransientTunnelBootError, shellNeedsPaint, transportOpenNeedsBootRefresh } from '../src/host-session.ts'

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
  const client = { state: 'open', fetch: async () => new Response('ok') }
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

test('only an automatic reconnect open refreshes the resident Host plugin roster', () => {
  const firstConnect = { phase: 'connecting', attempt: 1, reconnecting: false, route: null }
  const reconnect = { phase: 'connecting', attempt: 2, reconnecting: true, route: 'tunnel' }
  const open = { phase: 'open', attempt: 2, route: 'tunnel' }
  assert.equal(transportOpenNeedsBootRefresh(firstConnect, open, true), false)
  assert.equal(transportOpenNeedsBootRefresh(reconnect, open, false), false)
  assert.equal(transportOpenNeedsBootRefresh(reconnect, open, true), true)
  assert.equal(transportOpenNeedsBootRefresh(open, open, true), false)
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

test('a late superseded Host connect cannot repaint or arm after the newer Host', async () => {
  let releaseA
  const gateA = new Promise(resolve => { releaseA = resolve })
  const managers = new Map()
  const mounts = []
  const slot = { attach(source) { this.source = source }, async current() { return this.source.current() }, source: null }
  const session = new HostSession({
    slot,
    createManager(next) {
      const manager = fakeManager()
      if (next.profile.hostId === 'host-a') manager.current = async () => { await gateA; return manager.client }
      managers.set(next.profile.hostId, manager)
      return manager
    },
    async injectBoot(_client, next) { return selection(next.profile.hostId) },
    mount(next, hostId) { mounts.push({ rev: next.manifest.rev, hostId }) },
  })
  const stale = session.connect(prepared('host-a'))
  await new Promise(resolve => setTimeout(resolve, 0))
  await session.connect(prepared('host-b'))
  releaseA()
  assert.equal(await stale, null)
  assert.deepEqual(mounts, [{ rev: 'host-b', hostId: 'host-b' }])
  assert.equal(managers.get('host-a').stats().armed, 0)
  assert.equal(managers.get('host-b').stats().armed, 1)
})

test('a superseded Host connect suppresses its late boot failure', async () => {
  let rejectA
  const bootA = new Promise((_resolve, reject) => { rejectA = () => { reject(new Error('stale boot failed')) } })
  const session = new HostSession({
    slot: { attach() {}, async current() { throw new Error('unused slot') } },
    createManager() { return fakeManager() },
    async injectBoot(_client, next) {
      return next.profile.hostId === 'host-a' ? bootA : selection('host-b')
    },
    mount() {},
  })
  const stale = session.connect(prepared('host-a'))
  await new Promise(resolve => setTimeout(resolve, 0))
  await session.connect(prepared('host-b'))
  rejectA()
  assert.equal(await stale, null)
})

test('a superseded Host connect suppresses its late tunnel readiness failure', async () => {
  let rejectCurrentA
  const currentA = new Promise((_resolve, reject) => { rejectCurrentA = () => { reject(new Error('stale tunnel failed')) } })
  const session = new HostSession({
    slot: { attach() {}, async current() { throw new Error('unused slot') } },
    createManager(next) {
      const manager = fakeManager()
      if (next.profile.hostId === 'host-a') manager.current = async () => currentA
      return manager
    },
    async injectBoot(_client, next) { return selection(next.profile.hostId) },
    mount() {},
  })
  const stale = session.connect(prepared('host-a'))
  await new Promise(resolve => setTimeout(resolve, 0))
  await session.connect(prepared('host-b'))
  rejectCurrentA()
  assert.equal(await stale, null)
})

test('a superseded Host connect suppresses its late cached-boot failure', async () => {
  let rejectHydrateA
  const hydrateA = new Promise((_resolve, reject) => { rejectHydrateA = () => { reject(new Error('stale cache failed')) } })
  const session = new HostSession({
    slot: { attach() {}, async current() { throw new Error('unused slot') } },
    createManager() { return fakeManager() },
    async hydrateBoot(next) { return next.profile.hostId === 'host-a' ? hydrateA : null },
    async injectBoot(_client, next) { return selection(next.profile.hostId) },
    mount() {},
  })
  const stale = session.connect(prepared('host-a'))
  await new Promise(resolve => setTimeout(resolve, 0))
  await session.connect(prepared('host-b'))
  rejectHydrateA()
  assert.equal(await stale, null)
})

test('automatic reconnect refreshes a changed roster and skips repaint for the same revision', async () => {
  const mounts = []
  let injects = 0
  const manager = fakeManager()
  const responses = ['initial', 'changed', 'changed']
  const session = new HostSession({
    slot: { attach() {}, async current() { return manager.current() } },
    createManager() { return manager },
    async injectBoot() {
      injects += 1
      return selection(responses.shift())
    },
    mount(next) { mounts.push(next.manifest.rev) },
  })
  await session.connect(prepared('host-a'))
  const reconnecting = { phase: 'connecting', attempt: 2, reconnecting: true, route: 'tunnel' }
  const open = { phase: 'open', attempt: 2, route: 'tunnel' }
  await session.refreshAfterTransportActivity(reconnecting, open, true)
  await session.refreshAfterTransportActivity(reconnecting, open, true)
  assert.equal(session.refreshAfterTransportActivity({ ...reconnecting, reconnecting: false }, open, true), null)
  assert.deepEqual(mounts, ['initial', 'changed'])
  assert.equal(injects, 3)
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

test('a superseded remount cannot paint older Host boot data after a newer refresh', async () => {
  const mounts = []
  const manager = fakeManager()
  const slot = { attach(source) { this.source = source }, async current() { return this.source.current() }, source: null }
  let releaseOlder
  let releaseNewer
  const older = new Promise(resolve => { releaseOlder = () => { resolve(selection('older')) } })
  const newer = new Promise(resolve => { releaseNewer = () => { resolve(selection('newer')) } })
  const responses = [Promise.resolve(selection('initial')), older, newer]
  const session = new HostSession({
    slot,
    createManager() { return manager },
    async injectBoot() { return responses.shift() },
    mount(next) { mounts.push(next.manifest.rev) },
  })
  await session.connect(prepared('host-a'))
  const stale = session.remount()
  await new Promise(resolve => setTimeout(resolve, 0))
  const latest = session.remount()
  await new Promise(resolve => setTimeout(resolve, 0))
  releaseNewer()
  await latest
  releaseOlder()
  assert.equal(await stale, null)
  assert.deepEqual(mounts, ['initial', 'newer'])
  assert.equal(session.selection().manifest.rev, 'newer')
})

test('a newer refresh paints last when an older mount is already in flight', async () => {
  const manager = fakeManager()
  let releaseOlderMount
  let markOlderStarted
  const olderMountGate = new Promise(resolve => { releaseOlderMount = resolve })
  const olderStarted = new Promise(resolve => { markOlderStarted = resolve })
  const responses = ['initial', 'older', 'newer']
  let visible = null
  const mounts = []
  const session = new HostSession({
    slot: { attach() {}, async current() { return manager.current() } },
    createManager() { return manager },
    async injectBoot() { return selection(responses.shift()) },
    async mount(next) {
      mounts.push(next.manifest.rev)
      if (next.manifest.rev === 'older') {
        markOlderStarted()
        await olderMountGate
      }
      visible = next.manifest.rev
    },
  })
  await session.connect(prepared('host-a'))
  const stale = session.remount()
  await olderStarted
  const latest = session.remount()
  releaseOlderMount()
  assert.equal(await stale, null)
  assert.equal((await latest).manifest.rev, 'newer')
  assert.equal(visible, 'newer')
  assert.deepEqual(mounts, ['initial', 'older', 'newer'])
})

test('a superseded remount failure cannot surface after a newer refresh succeeds', async () => {
  const mounts = []
  const manager = fakeManager()
  let rejectOlder
  let releaseNewer
  const older = new Promise((_resolve, reject) => { rejectOlder = () => { reject(new Error('stale refresh failed')) } })
  const newer = new Promise(resolve => { releaseNewer = () => { resolve(selection('newer')) } })
  const responses = [Promise.resolve(selection('initial')), older, newer]
  const session = new HostSession({
    slot: { attach() {}, async current() { return manager.current() } },
    createManager() { return manager },
    async injectBoot() { return responses.shift() },
    mount(next) { mounts.push(next.manifest.rev) },
  })
  await session.connect(prepared('host-a'))
  const stale = session.remount()
  await new Promise(resolve => setTimeout(resolve, 0))
  const latest = session.remount()
  releaseNewer()
  await latest
  rejectOlder()
  await assert.doesNotReject(stale)
  assert.deepEqual(mounts, ['initial', 'newer'])
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

test('forgetting paint after tearing down the shell remounts the same Host roster', async () => {
  const mounts = []
  const session = new HostSession({
    slot: { attach() {}, async current() { return fakeManager().current() } },
    createManager() { return fakeManager() },
    async injectBoot() { return selection('r1') },
    mount(next) { mounts.push(next.manifest.rev) },
  })
  await session.connect(prepared('host-a'))
  session.stop()
  session.forgetPaint()
  await session.connect(prepared('host-a'))
  assert.deepEqual(mounts, ['r1', 'r1'])
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

test('a closed tunnel during boot waits for the next live client instead of failing connect', async () => {
  const closed = { state: 'closed', fetch: async () => { throw new TunnelError('closed', 'tunnel is closed') } }
  const live = { state: 'open', fetch: async () => new Response('ok') }
  const clients = [closed, live]
  const manager = {
    start() {},
    stop() {},
    async current() { return clients.shift() ?? live },
    armHeartbeat() {},
    async probeNow() {},
  }
  let injects = 0
  const session = new HostSession({
    slot: { attach() {}, async current() { return live } },
    createManager() { return manager },
    async injectBoot(client) {
      injects += 1
      if (client.state !== 'open') throw new TunnelError('closed', 'tunnel is closed')
      return selection('r1')
    },
    mount() {},
  })
  await session.connect(prepared('host-a'))
  assert.equal(injects, 2)
})

test('a hung boot fetch on a still-open tunnel closes the client and waits for the next one', async () => {
  const hung = {
    state: 'open',
    close() { this.state = 'closed' },
  }
  const live = { state: 'open', close() {} }
  const clients = [hung, live]
  const manager = {
    start() {},
    stop() {},
    async current() { return clients.shift() ?? live },
    armHeartbeat() {},
    async probeNow() {},
  }
  let injects = 0
  const session = new HostSession({
    slot: { attach() {}, async current() { return live } },
    createManager() { return manager },
    async injectBoot(client) {
      injects += 1
      if (client === hung) throw new TunnelError('timeout', 'boot fetch timed out: /')
      return selection('r1')
    },
    mount() {},
  })
  await session.connect(prepared('host-a'))
  assert.equal(injects, 2)
  assert.equal(hung.state, 'closed')
})

test('isTransientTunnelBootError recognizes a dropped or stalled tunnel during boot', () => {
  assert.equal(isTransientTunnelBootError(new TunnelError('closed', 'tunnel is closed')), true)
  assert.equal(isTransientTunnelBootError(new TunnelError('handshake', 'endpoint WebSocket connection failed')), true)
  assert.equal(isTransientTunnelBootError(new TunnelError('timeout', 'boot fetch timed out: /')), true)
  assert.equal(isTransientTunnelBootError(new Error('boot manifest fetch failed: HTTP 500')), false)
  assert.equal(isTransientTunnelBootError(new TunnelError('closed', 'Active Host connection stopped')), false)
})

test('isHostSessionStoppedError only matches a cancelled Host session', () => {
  assert.equal(isHostSessionStoppedError(new TunnelError('closed', 'Active Host connection stopped')), true)
  assert.equal(isHostSessionStoppedError(new Error('Active Host connection stopped')), true)
  assert.equal(isHostSessionStoppedError(new TunnelError('closed', 'tunnel is closed')), false)
  assert.equal(isHostSessionStoppedError(new TunnelError('handshake', 'endpoint WebSocket connection failed')), false)
})

test('stop during an in-flight connect rejects as a cancelled Host session, not a transport failure', async () => {
  let rejectCurrent
  const pending = new Promise((_, reject) => { rejectCurrent = reject })
  const manager = fakeManager()
  manager.current = () => pending
  manager.stop = () => {
    rejectCurrent(new Error('transport teardown failed'))
  }
  const session = new HostSession({
    slot: { attach() {}, async current() { return manager.client } },
    createManager() { return manager },
    async injectBoot() { return selection('r1') },
    mount() {},
  })
  const connecting = session.connect(prepared('host-a'))
  await new Promise(resolve => setTimeout(resolve, 0))
  session.stop()
  await assert.rejects(connecting, error => isHostSessionStoppedError(error))
})
