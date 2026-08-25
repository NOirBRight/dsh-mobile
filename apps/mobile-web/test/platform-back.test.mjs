import test from 'node:test'
import assert from 'node:assert/strict'
import { MOBILE_PLATFORM_BACK_EVENT, routePlatformBack } from '../src/platform-back.ts'

function fallback(calls) {
  return {
    historyBack: () => calls.push('history'),
    exitApp: () => calls.push('exit'),
  }
}

test('cancelable plugin handler consumes native Back before fallback', () => {
  const document = new EventTarget()
  const calls = []
  document.addEventListener(MOBILE_PLATFORM_BACK_EVENT, event => event.preventDefault())
  assert.equal(routePlatformBack(document, true, fallback(calls)), 'consumed')
  assert.deepEqual(calls, [])
})

test('unhandled Back uses history when available', () => {
  const calls = []
  assert.equal(routePlatformBack(new EventTarget(), true, fallback(calls)), 'history')
  assert.deepEqual(calls, ['history'])
})

test('unhandled root Back exits the native app', () => {
  const calls = []
  assert.equal(routePlatformBack(new EventTarget(), false, fallback(calls)), 'exit')
  assert.deepEqual(calls, ['exit'])
})
