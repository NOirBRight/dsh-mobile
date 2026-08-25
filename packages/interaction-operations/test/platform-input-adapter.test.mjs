import test from 'node:test'
import assert from 'node:assert/strict'
import { installPlatformInputAdapter, PLATFORM_BACK_EVENT } from '../src/client/platform-input-adapter.ts'

function dispatch(document) {
  const event = new Event(PLATFORM_BACK_EVENT, { cancelable: true })
  document.dispatchEvent(event)
  return event.defaultPrevented
}

test('handled and blocked outcomes consume platform Back', () => {
  for (const status of ['handled', 'blocked']) {
    const document = new EventTarget()
    const dispose = installPlatformInputAdapter({ dispatch: () => ({ status, adapter: 'test' }) }, document)
    assert.equal(dispatch(document), true)
    dispose()
    assert.equal(dispatch(document), false)
  }
})

test('unhandled outcome lets the App Shell fall through', () => {
  const document = new EventTarget()
  installPlatformInputAdapter({ dispatch: () => ({ status: 'unhandled' }) }, document)
  assert.equal(dispatch(document), false)
})
