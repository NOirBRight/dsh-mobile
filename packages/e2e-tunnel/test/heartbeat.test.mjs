import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HeartbeatController, TunnelError } from '../src/index.ts'

function fakeScheduler() {
  const queue = []
  return {
    queue,
    setTimeout(callback, delay) { const handle = { callback, delay, cancelled: false }; queue.push(handle); return handle },
    clearTimeout(handle) { handle.cancelled = true },
    async runNext() { const handle = queue.shift(); assert.ok(handle); if (!handle.cancelled) await handle.callback() },
  }
}

test('heartbeat uses configured cadence and marks stale after two misses', async () => {
  const scheduler = fakeScheduler()
  let probes = 0
  const stale = []
  const heartbeat = new HeartbeatController({
    target: { probe: async (timeout) => { probes += 1; assert.equal(timeout, 10_000); throw new TunnelError('stale') } },
    scheduler, onStale: (error) => stale.push(error.code),
  })
  heartbeat.start()
  assert.equal(scheduler.queue[0].delay, 25_000)
  await scheduler.runNext()
  assert.deepEqual(stale, [])
  assert.equal(scheduler.queue[0].delay, 25_000)
  await scheduler.runNext()
  assert.deepEqual(stale, ['stale'])
  assert.equal(probes, 2)
  assert.equal(scheduler.queue.length, 0)
})

test('successful foreground probe resets missed heartbeat count', async () => {
  const scheduler = fakeScheduler()
  const outcomes = [false, true, false, false]
  let stale = 0
  const heartbeat = new HeartbeatController({
    target: { probe: async () => { if (!outcomes.shift()) throw new TunnelError('stale') } },
    scheduler, onStale: () => { stale += 1 },
  })
  heartbeat.start()
  await scheduler.runNext() // one miss
  await heartbeat.probeNow() // foreground success resets
  await scheduler.runNext() // one miss again
  assert.equal(stale, 0)
  await scheduler.runNext() // second consecutive miss
  assert.equal(stale, 1)
})

test('stopping heartbeat cancels future work', () => {
  const scheduler = fakeScheduler()
  const heartbeat = new HeartbeatController({ target: { probe: async () => {} }, scheduler, onStale: () => {} })
  heartbeat.start()
  heartbeat.stop()
  assert.equal(scheduler.queue[0].cancelled, true)
})
