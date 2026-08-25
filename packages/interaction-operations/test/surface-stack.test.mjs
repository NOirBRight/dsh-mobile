import test from 'node:test'
import assert from 'node:assert/strict'
import { InteractionSurfaceStack } from '../src/client/surface-stack.ts'

const back = { type: 'back', source: { kind: 'platform', detail: 'android-back' } }

test('surface kinds resolve by policy and one Back dismisses one layer', () => {
  const calls = []
  const stack = new InteractionSurfaceStack()
  stack.register({ id: 'drawer', kind: 'navigation', dismiss: () => { calls.push('drawer') } })
  stack.register({ id: 'details', kind: 'details', dismiss: () => { calls.push('details') } })
  stack.register({ id: 'picker', kind: 'popup', dismiss: () => { calls.push('picker') } })
  assert.equal(stack.handle(back), true)
  assert.deepEqual(calls, ['picker'])
})

test('same-kind surfaces are LIFO and disposal removes the layer', () => {
  const calls = []
  const stack = new InteractionSurfaceStack()
  stack.register({ id: 'first', kind: 'popup', dismiss: () => { calls.push('first') } })
  const dispose = stack.register({ id: 'second', kind: 'popup', dismiss: () => { calls.push('second') } })
  assert.equal(stack.handle(back), true)
  dispose()
  assert.equal(stack.handle(back), true)
  assert.deepEqual(calls, ['second', 'first'])
})

test('registered surface failure blocks lower fallthrough', () => {
  const stack = new InteractionSurfaceStack()
  const error = new Error('cannot dismiss')
  stack.register({ id: 'drawer', kind: 'navigation', dismiss: () => { throw error } })
  assert.throws(() => stack.handle(back), error)
})
