import test from 'node:test'
import assert from 'node:assert/strict'
import { activateHostProfile, completeProfileOnboarding, profileRemovalTransition, removeHostProfile, runHostProfileSwitch } from '../src/profile-lifecycle.ts'

test('removing the final profile transfers directly to formal onboarding', async () => {
  const calls = []
  const transition = await removeHostProfile('host-a', 'host-a', {
    remove: async id => { calls.push('remove:' + id) },
    count: async () => 0,
    reconnect: async () => { calls.push('reconnect') },
    onboarding: async () => { calls.push('onboarding') },
  })
  assert.equal(transition, 'onboarding')
  assert.deepEqual(calls, ['remove:host-a', 'onboarding'])
})

test('device activation persists first and resolves only after reconnect succeeds', async () => {
  const calls = []
  await activateHostProfile('host-b', {
    setActive: async hostId => { calls.push('active:' + hostId) },
    reconnect: async () => { calls.push('reconnect') },
  })
  assert.deepEqual(calls, ['active:host-b', 'reconnect'])

  const failed = []
  await assert.rejects(activateHostProfile('host-c', {
    setActive: async () => { failed.push('active'); throw new Error('save failed') },
    reconnect: async () => { failed.push('reconnect') },
  }), /save failed/)
  assert.deepEqual(failed, ['active'])
})

test('Host switching keeps a connecting surface visible until activation settles', async () => {
  const pending = Promise.withResolvers()
  const events = []
  const switching = runHostProfileSwitch(
    { hostId: 'host-lab', displayName: '3082 · Lab' },
    async hostId => { events.push('activate:' + hostId); await pending.promise },
    {
      showConnecting: name => { events.push('show:' + name) },
      showError: message => { events.push('error:' + message) },
      close: () => { events.push('close') },
    },
  )

  assert.deepEqual(events, ['show:3082 · Lab', 'activate:host-lab'])
  pending.resolve()
  assert.equal(await switching, true)
  assert.deepEqual(events, ['show:3082 · Lab', 'activate:host-lab', 'close'])
})

test('Host switching times out a hung activation instead of spinning forever', async () => {
  const events = []
  const switched = await runHostProfileSwitch(
    { hostId: 'host-lab', displayName: '3082 · Lab' },
    async () => new Promise(() => {}),
    {
      showConnecting: name => { events.push('show:' + name) },
      showError: message => { events.push('error:' + message) },
      close: () => { events.push('close') },
      abort: () => { events.push('abort') },
    },
    20,
  )
  assert.equal(switched, false)
  assert.equal(events[0], 'show:3082 · Lab')
  assert.ok(events.includes('abort'))
  assert.match(events.at(-1) ?? '', /连接超时/)
})

test('Host switching keeps the progress surface open and reports activation failures', async () => {
  const events = []
  const switched = await runHostProfileSwitch(
    { hostId: 'host-lab', displayName: '3082 · Lab' },
    async () => { throw new Error('Lab unreachable') },
    {
      showConnecting: name => { events.push('show:' + name) },
      showError: message => { events.push('error:' + message) },
      close: () => { events.push('close') },
    },
  )

  assert.equal(switched, false)
  assert.deepEqual(events, ['show:3082 · Lab', 'error:Lab unreachable'])
})

test('formal onboarding absorbs a failed launch offer without a legacy retry page', async () => {
  const errors = []
  const surface = {
    waitForScan: async () => {}, show: () => {},
    showError: message => { errors.push(message) }, destroy: () => {},
  }
  await completeProfileOnboarding({
    surface,
    initialError: '配对失败：expired code。请检查二维码后重试',
    scan: async () => 'fresh-offer',
    prepare: async () => 'prepared',
  })
  assert.deepEqual(errors, ['配对失败：expired code。请检查二维码后重试'])
})

test('formal onboarding owns retry until one profile is prepared', async () => {
  let scans = 0
  let destroyed = 0
  const errors = []
  const status = []
  const surface = {
    waitForScan: async () => {},
    show: message => { status.push(message) },
    showError: message => { errors.push(message) },
    destroy: () => { destroyed += 1 },
  }
  const prepared = await completeProfileOnboarding({
    surface,
    scan: async () => 'offer-' + (++scans),
    prepare: async offer => {
      if (offer === 'offer-1') throw new Error('expired code')
      return { offer }
    },
  })
  assert.deepEqual(prepared, { offer: 'offer-2' })
  assert.deepEqual(errors, ['配对失败：expired code。请检查二维码后重试'])
  assert.deepEqual(status, ['二维码已识别，正在保存 Host Profile…', '二维码已识别，正在保存 Host Profile…'])
  assert.equal(destroyed, 1)
})

test('profile removal chooses one explicit post-removal lifecycle', () => {
  assert.equal(profileRemovalTransition({ removedActive: false, remainingProfiles: 2 }), 'stay')
  assert.equal(profileRemovalTransition({ removedActive: true, remainingProfiles: 1 }), 'reconnect')
  assert.equal(profileRemovalTransition({ removedActive: true, remainingProfiles: 0 }), 'onboarding')
})
