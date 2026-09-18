import test from 'node:test'
import assert from 'node:assert/strict'
import { installWebViewPolyfills } from '../src/webview-polyfills.ts'

/** First line of Host api-gateway ClientRemoteEvents.pumpEvents. */
function openEventsGenerationSignal(signal, failed) {
  return AbortSignal.any([signal, failed.signal])
}

test('Host $events generation throws on WebView 101 without AbortSignal.any', () => {
  const native = AbortSignal.any
  const failed = new AbortController()
  const generation = new AbortController()
  Object.defineProperty(AbortSignal, 'any', { configurable: true, writable: true, value: undefined })
  try {
    assert.equal(typeof AbortSignal.any, 'undefined')
    assert.throws(
      () => openEventsGenerationSignal(generation.signal, failed),
      { name: 'TypeError' },
    )
  } finally {
    Object.defineProperty(AbortSignal, 'any', { configurable: true, writable: true, value: native })
  }
})

test('polyfill lets Host $events combine generation signals when AbortSignal.any is missing', () => {
  const native = AbortSignal.any
  Object.defineProperty(AbortSignal, 'any', { configurable: true, writable: true, value: undefined })
  try {
    installWebViewPolyfills()
    const failed = new AbortController()
    const generation = new AbortController()
    const combined = openEventsGenerationSignal(generation.signal, failed)
    assert.equal(combined.aborted, false)
    failed.abort('stream-lost')
    assert.equal(combined.aborted, true)
    assert.equal(combined.reason, 'stream-lost')
  } finally {
    Object.defineProperty(AbortSignal, 'any', { configurable: true, writable: true, value: native })
  }
})

test('polyfill does not replace a native AbortSignal.any', () => {
  const native = AbortSignal.any
  installWebViewPolyfills()
  assert.equal(AbortSignal.any, native)
})
