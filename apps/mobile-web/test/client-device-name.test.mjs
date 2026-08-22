import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveClientDeviceName } from '../src/client-device-name.ts'

test('native Client Device Name is sanitized before Host presentation', async () => {
  const name = await resolveClientDeviceName({ getName: async () => ({ name: '  Noir Phone\u0000  ' }) })
  assert.equal(name, 'Noir Phone')
})

test('Client Device Name has a stable product fallback when native lookup fails', async () => {
  const name = await resolveClientDeviceName({ getName: async () => { throw new Error('unavailable') } })
  assert.equal(name, 'Android device')
})
