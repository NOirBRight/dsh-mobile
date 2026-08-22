import test from 'node:test'
import assert from 'node:assert/strict'
import { createBackgroundConnectionControl, readBackgroundConnectionPreference, writeBackgroundConnectionPreference } from '../src/background-connection.ts'

test('reliable background mode is opt-in and persists explicitly', () => {
  const values = new Map()
  const storage = {
    getItem(key) { return values.get(key) ?? null },
    setItem(key, value) { values.set(key, value) },
  }
  assert.equal(readBackgroundConnectionPreference(storage), false)
  writeBackgroundConnectionPreference(storage, true)
  assert.equal(readBackgroundConnectionPreference(storage), true)
  writeBackgroundConnectionPreference(storage, false)
  assert.equal(readBackgroundConnectionPreference(storage), false)
})

test('browser background control degrades to a no-op', async () => {
  const control = createBackgroundConnectionControl(null)
  await control.setEnabled(true)
  let wakes = 0
  const off = control.subscribeWake(() => { wakes += 1 })
  off()
  assert.equal(wakes, 0)
})

test('native background control forwards enablement and disposes wake listeners', async () => {
  const enabled = []
  let listener
  let removed = 0
  const bridge = {
    async setEnabled(value) { enabled.push(value.enabled) },
    async addListener(name, next) {
      assert.equal(name, 'wake')
      listener = next
      return { async remove() { removed += 1 } }
    },
  }
  const control = createBackgroundConnectionControl(bridge)
  let wakes = 0
  const off = control.subscribeWake(() => { wakes += 1 })
  await control.setEnabled(true)
  listener()
  assert.equal(wakes, 1)
  off()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(enabled, [true])
  assert.equal(removed, 1)
})
