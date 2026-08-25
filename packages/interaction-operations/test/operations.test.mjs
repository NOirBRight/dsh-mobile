import test from 'node:test'
import assert from 'node:assert/strict'
import { InteractionOperations } from '../src/client/operations.ts'

const intent = { type: 'back', source: { kind: 'platform' } }

test('first accepting target adapter wins', () => {
  const calls = []
  const operations = new InteractionOperations([
    { name: 'overlay', handle: () => { calls.push('overlay'); return false } },
    { name: 'layout', handle: () => { calls.push('layout'); return true } },
    { name: 'history', handle: () => { calls.push('history'); return true } },
  ])
  assert.deepEqual(operations.dispatch(intent), { status: 'handled', adapter: 'layout' })
  assert.deepEqual(calls, ['overlay', 'layout'])
})

test('adapter failure blocks dangerous fall-through', () => {
  const error = new Error('broken modal')
  const operations = new InteractionOperations([
    { name: 'overlay', handle: () => { throw error } },
    { name: 'exit', handle: () => true },
  ])
  assert.deepEqual(operations.dispatch(intent), { status: 'blocked', adapter: 'overlay', error })
})

test('no accepting adapter returns unhandled', () => {
  const operations = new InteractionOperations([{ name: 'layout', handle: () => false }])
  assert.deepEqual(operations.dispatch(intent), { status: 'unhandled' })
})

test('registered surfaces participate in router Back handling', () => {
  const calls = []
  const operations = new InteractionOperations([])
  const dispose = operations.registerSurface({ id: 'drawer', kind: 'navigation', dismiss: () => { calls.push('drawer') } })
  assert.deepEqual(operations.dispatch(intent), { status: 'handled', adapter: 'registered-surfaces' })
  assert.deepEqual(calls, ['drawer'])
  dispose()
  assert.deepEqual(operations.dispatch(intent), { status: 'unhandled' })
})
