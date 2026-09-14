import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'vite'
import {
  createMemorySessionRecordStore,
  createSessionCache,
} from '../../../packages/ui-layout-mobile/src/client/session-cache.ts'
import {
  createColdStartOverlayController,
} from '../../../packages/ui-layout-mobile/src/client/cold-start-overlay.ts'

function observable(initial) {
  const listeners = new Set()
  let snapshot = initial
  return {
    getSnapshot() { return snapshot },
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set(next) {
      snapshot = next
      for (const listener of listeners) listener()
    },
    patch(over) {
      snapshot = { ...snapshot, ...over }
      for (const listener of listeners) listener()
    },
  }
}

function event(seq, text = String(seq)) {
  return { type: 'user/message', seq, time: 100 + seq, data: { text } }
}

function summary(id, over = {}) {
  return {
    id,
    title: id,
    displayTitle: id,
    updatedAt: 10,
    blank: false,
    running: true,
    completed: true,
    depth: 2,
    ...over,
  }
}

function sessionsHarness(listState, bindings = {}) {
  const list = observable(listState)
  const opened = []
  const refreshed = []
  return {
    opened,
    refreshed,
    list,
    sessions: {
      list,
      binding(id) { return bindings[id] },
      open(id) {
        const ids = list.getSnapshot().ids ?? []
        if (!ids.includes(id)) throw new Error('unknown session ' + id)
        opened.push(id)
      },
      async refresh() { refreshed.push('refresh') },
    },
  }
}

function binding(openState = 'loading', windowOver = {}) {
  const session = observable({ openState })
  const eventSource = observable({
    entries: [],
    hasMore: false,
    revision: 0,
    change: { kind: 'replace', entries: [] },
    ...windowOver,
  })
  return { session, eventSource }
}

async function settled() {
  await new Promise(resolve => setTimeout(resolve, 0))
  await new Promise(resolve => setTimeout(resolve, 0))
}

test('phase pending with an empty byId is not an empty-list success', async () => {
  const cache = createSessionCache('host-a', createMemorySessionRecordStore())
  await cache.writeList([{ sessionId: 'cached', title: 'Cached', updatedAt: 1, blank: false }])
  const harness = sessionsHarness({ phase: 'pending', ids: [], byId: {}, current: undefined })
  const baselines = []
  const controller = createColdStartOverlayController({
    sessions: harness.sessions,
    cache,
    hostId: 'host-a',
    generation: 1,
    onBaseline(detail) { baselines.push(detail) },
  })
  await settled()
  const model = controller.snapshot()
  assert.equal(model.listOverlay, true)
  assert.equal(model.listRows.map(row => row.sessionId).join(), 'cached')
  assert.equal(model.composerLocked, true)
  assert.equal(baselines.at(-1)?.listBaseline, 'pending')
  assert.deepEqual((await cache.readList())?.map(row => row.sessionId), ['cached'])
  controller.dispose()
})

test('list ready including empty drops the list overlay and overwrites the cache', async () => {
  const cache = createSessionCache('host-a', createMemorySessionRecordStore())
  await cache.writeList([{ sessionId: 'ghost', title: 'Ghost', updatedAt: 1, blank: false }])
  await cache.writeWindow('ghost', { entries: [{ event: event(1, 'ghost') }], hasMore: false })
  const harness = sessionsHarness({ phase: 'pending', ids: [], byId: {}, current: undefined })
  const controller = createColdStartOverlayController({
    sessions: harness.sessions,
    cache,
    hostId: 'host-a',
    generation: 1,
  })
  await settled()
  harness.list.set({ phase: 'ready', ids: [], byId: {}, current: undefined })
  await settled()
  const model = controller.snapshot()
  assert.equal(model.listOverlay, false)
  assert.equal(model.conversationOverlay, false)
  assert.equal(model.composerLocked, false)
  assert.deepEqual(await cache.readList(), [])
  assert.equal(await cache.readWindow(), undefined)
  controller.dispose()
})

test('eventSource initial empty replace is not the window baseline', async () => {
  const cache = createSessionCache('host-a', createMemorySessionRecordStore())
  await cache.writeWindow('s1', { entries: [{ event: event(1, 'cached') }], hasMore: false })
  const live = binding('loading')
  const harness = sessionsHarness({
    phase: 'ready',
    ids: ['s1'],
    byId: { s1: summary('s1') },
    current: 's1',
  }, { s1: live })
  const controller = createColdStartOverlayController({
    sessions: harness.sessions,
    cache,
    hostId: 'host-a',
    generation: 1,
  })
  await settled()
  const pending = controller.snapshot()
  assert.equal(pending.listOverlay, false)
  assert.equal(pending.conversationOverlay, true)
  assert.equal(pending.windowEntries[0]?.event.data.text, 'cached')
  assert.equal((await cache.readWindow())?.window.entries[0]?.event.data.text, 'cached')

  live.eventSource.set({
    entries: [],
    hasMore: false,
    revision: 0,
    change: { kind: 'replace', entries: [] },
  })
  await settled()
  assert.equal(controller.snapshot().conversationOverlay, true)

  live.session.patch({ openState: 'open' })
  await settled()
  assert.equal(controller.snapshot().conversationOverlay, false)
  assert.deepEqual(await cache.readWindow(), { sessionId: 's1', window: { entries: [], hasMore: false } })
  controller.dispose()
})

test('window error keeps the overlay when a snapshot exists and does not open missing ids', async () => {
  const cache = createSessionCache('host-a', createMemorySessionRecordStore())
  await cache.writeList([
    { sessionId: 'keep', title: 'Keep', updatedAt: 1, blank: false },
    { sessionId: 'gone', title: 'Gone', updatedAt: 2, blank: false },
  ])
  await cache.writeWindow('keep', { entries: [{ event: event(4, 'still here') }], hasMore: false })
  const live = binding('error')
  const harness = sessionsHarness({
    phase: 'ready',
    ids: ['keep'],
    byId: { keep: summary('keep', { title: 'Keep' }) },
    current: 'keep',
  }, { keep: live })
  const controller = createColdStartOverlayController({
    sessions: harness.sessions,
    cache,
    hostId: 'host-a',
    generation: 1,
  })
  await settled()
  const model = controller.snapshot()
  assert.equal(model.conversationOverlay, true)
  assert.equal(model.windowEntries[0]?.event.data.text, 'still here')
  controller.requestOpen('gone')
  await settled()
  assert.deepEqual(harness.opened, [])
  controller.requestOpen('keep')
  await settled()
  assert.deepEqual(harness.opened, ['keep'])
  controller.dispose()
})

test('cached row clicks queue until the live list is ready and then open only live ids', async () => {
  const cache = createSessionCache('host-a', createMemorySessionRecordStore())
  await cache.writeList([
    { sessionId: 'alive', title: 'Alive', updatedAt: 1, blank: false },
    { sessionId: 'dead', title: 'Dead', updatedAt: 2, blank: false },
  ])
  const harness = sessionsHarness({ phase: 'pending', ids: [], byId: {}, current: undefined })
  const controller = createColdStartOverlayController({
    sessions: harness.sessions,
    cache,
    hostId: 'host-a',
    generation: 1,
  })
  await settled()
  controller.requestOpen('dead')
  controller.requestOpen('alive')
  await settled()
  assert.deepEqual(harness.opened, [])
  harness.list.set({
    phase: 'ready',
    ids: ['alive'],
    byId: { alive: summary('alive', { title: 'Alive' }) },
    current: 'alive',
  })
  await settled()
  assert.deepEqual(harness.opened, ['alive'])
  controller.requestOpen('dead')
  await settled()
  assert.deepEqual(harness.opened, ['alive'])
  controller.dispose()
})

test('a new generation restores overlays and republishes pending baselines', async () => {
  const cache = createSessionCache('host-a', createMemorySessionRecordStore())
  await cache.writeList([{ sessionId: 's1', title: 'S', updatedAt: 1, blank: false }])
  const live = binding('open', { entries: [{ type: 'event', event: event(1) }], hasMore: false, revision: 1 })
  const harness = sessionsHarness({
    phase: 'ready',
    ids: ['s1'],
    byId: { s1: summary('s1') },
    current: 's1',
  }, { s1: live })
  const baselines = []
  const controller = createColdStartOverlayController({
    sessions: harness.sessions,
    cache,
    hostId: 'host-a',
    generation: 1,
    onBaseline(detail) { baselines.push({ ...detail }) },
  })
  await settled()
  assert.equal(controller.snapshot().listOverlay, false)
  assert.equal(controller.snapshot().conversationOverlay, false)
  controller.handleTransport({ hostId: 'host-a', generation: 2 })
  await settled()
  const after = controller.snapshot()
  assert.equal(after.listOverlay, true)
  assert.equal(after.conversationOverlay, true)
  assert.equal(after.composerLocked, true)
  assert.equal(baselines.at(-1)?.generation, 2)
  assert.equal(baselines.at(-1)?.listBaseline, 'pending')
  assert.equal(baselines.at(-1)?.windowBaseline, 'pending')
  assert.equal(baselines.at(-1)?.hasListSnapshot, true)
  assert.deepEqual(harness.refreshed, ['refresh'])
  live.session.patch({ openState: 'loading' })
  harness.list.set({
    phase: 'ready',
    ids: ['s1'],
    byId: { s1: summary('s1') },
    current: 's1',
  })
  await settled()
  assert.equal(controller.snapshot().listOverlay, false)
  assert.equal(controller.snapshot().conversationOverlay, true)
  controller.dispose()
})

test('Host switch loads the other Host cache and never opens the previous Host ids', async () => {
  const store = createMemorySessionRecordStore()
  const a = createSessionCache('host-a', store)
  const b = createSessionCache('host-b', store)
  await a.writeList([{ sessionId: 'from-a', title: 'A', updatedAt: 1, blank: false }])
  await b.writeList([{ sessionId: 'from-b', title: 'B', updatedAt: 1, blank: false }])
  const harness = sessionsHarness({ phase: 'pending', ids: [], byId: {}, current: undefined })
  const controller = createColdStartOverlayController({
    sessions: harness.sessions,
    cache: a,
    createCache: hostId => createSessionCache(hostId, store),
    hostId: 'host-a',
    generation: 1,
  })
  await settled()
  assert.equal(controller.snapshot().listRows[0]?.sessionId, 'from-a')
  controller.handleTransport({ hostId: 'host-b', generation: 3 })
  await settled()
  assert.equal(controller.snapshot().listRows[0]?.sessionId, 'from-b')
  controller.requestOpen('from-a')
  harness.list.set({
    phase: 'ready',
    ids: ['from-b'],
    byId: { 'from-b': summary('from-b') },
    current: 'from-b',
  })
  await settled()
  assert.deepEqual(harness.opened, [])
  controller.dispose()
})

test('retry refreshes the live list and re-opens the current session when it still exists', async () => {
  const cache = createSessionCache('host-a', createMemorySessionRecordStore())
  const live = binding('error')
  const harness = sessionsHarness({
    phase: 'ready',
    ids: ['s1'],
    byId: { s1: summary('s1') },
    current: 's1',
  }, { s1: live })
  const controller = createColdStartOverlayController({
    sessions: harness.sessions,
    cache,
    hostId: 'host-a',
    generation: 1,
  })
  await settled()
  await controller.handleRetry()
  await settled()
  assert.deepEqual(harness.refreshed, ['refresh'])
  assert.deepEqual(harness.opened, ['s1'])
  controller.dispose()
})

test('no snapshot paints a cover without fake example tasks', async () => {
  const cache = createSessionCache('host-a', createMemorySessionRecordStore())
  const harness = sessionsHarness({ phase: 'pending', ids: [], byId: {}, current: undefined })
  const controller = createColdStartOverlayController({
    sessions: harness.sessions,
    cache,
    hostId: 'host-a',
    generation: 1,
  })
  await settled()
  const model = controller.snapshot()
  assert.equal(model.listOverlay, true)
  assert.deepEqual(model.listRows, [])
  assert.equal(model.hasListSnapshot, false)
  assert.equal(model.conversationOverlay, true)
  assert.deepEqual(model.windowEntries, [])
  controller.dispose()
})

test('later prepend does not drop an overlay that has not seen openState open', async () => {
  const cache = createSessionCache('host-a', createMemorySessionRecordStore())
  const live = binding('loading')
  const harness = sessionsHarness({
    phase: 'ready',
    ids: ['s1'],
    byId: { s1: summary('s1') },
    current: 's1',
  }, { s1: live })
  const controller = createColdStartOverlayController({
    sessions: harness.sessions,
    cache,
    hostId: 'host-a',
    generation: 1,
  })
  await settled()
  live.eventSource.set({
    entries: [{ type: 'event', event: event(1, 'older') }],
    hasMore: true,
    revision: 1,
    change: { kind: 'prepend', entries: [{ type: 'event', event: event(1, 'older') }] },
  })
  await settled()
  assert.equal(controller.snapshot().conversationOverlay, true)
  assert.equal(await cache.readWindow(), undefined)
  controller.dispose()
})

test('layout apply wires the overlay adapter without sessionHydration', async () => {
  const apply = await readFile(new URL(
    '../../../packages/ui-layout-mobile/src/client/index.ts',
    import.meta.url,
  ), 'utf8')
  const overlay = await readFile(new URL(
    '../../../packages/ui-layout-mobile/src/client/cold-start-overlay.ts',
    import.meta.url,
  ), 'utf8')
  assert.match(apply, /installColdStartOverlayAdapter/)
  assert.doesNotMatch(apply, /sessionHydration/)
  assert.doesNotMatch(overlay, /sessionHydration/)
  assert.doesNotMatch(overlay, /shell\.overlay/)
  assert.match(overlay, /dsh-mobile:cold-start-baseline/)
  assert.match(overlay, /dsh-mobile:cold-start-retry/)
  assert.match(overlay, /dsh-mobile:cold-start-transport/)
})

test('syncing overlay is clickable, composer cannot send, and both seats yield after baselines', async () => {
  const fixtureRoot = resolve(import.meta.dirname, 'fixtures/cold-start-overlay')
  const outDir = await mkdtemp(join(tmpdir(), 'dsh-mobile-cold-start-overlay-'))
  try {
    await build({
      root: fixtureRoot,
      base: './',
      configFile: false,
      logLevel: 'silent',
      build: { outDir, emptyOutDir: true },
    })
    const chrome = spawnSync(process.env.CHROME_BIN ?? '/usr/bin/google-chrome', [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--allow-file-access-from-files',
      '--window-size=360,800', '--virtual-time-budget=2000', '--dump-dom',
      'file://' + resolve(outDir, 'index.html'),
    ], { encoding: 'utf8', timeout: 15_000 })
    assert.equal(chrome.status, 0, chrome.stderr)
    assert.match(chrome.stdout, /data-ready="true"/, 'overlay fixture did not settle: ' + chrome.stderr)
    const capture = (name) => new RegExp('data-' + name + '="([^"]*)"').exec(chrome.stdout)?.[1]
    assert.equal(capture('list-parent'), '导航抽屉', 'list overlay covers sidebar inside the drawer')
    assert.equal(capture('list-in-shell'), 'false', 'list overlay must not steal the Codex overlay seat')
    assert.equal(capture('conversation-in-shell'), 'false')
    assert.equal(capture('codex-survived'), 'true')
    assert.equal(capture('row-title'), 'Cached task')
    assert.match(capture('event-text') ?? '', /cached hello/)
    assert.equal(capture('list-hidden-pending'), 'false')
    assert.equal(capture('send-while-locked'), '0', '同步中可点不可发')
    assert.equal(capture('opened-while-pending'), '')
    assert.equal(capture('opened-after-ready'), 's1')
    assert.equal(capture('list-hidden-ready'), 'true', 'list overlay yields once list is ready')
    assert.equal(capture('conversation-hidden-ready'), 'true', 'conversation overlay yields once the window is open')
    assert.equal(capture('send-after-ready'), '1', 'composer sends again after both baselines')
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
})
