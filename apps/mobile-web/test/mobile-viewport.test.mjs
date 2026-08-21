import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveMobileViewportHeight } from '../../../packages/ui-layout-mobile/src/client/mobile-viewport.ts'

test('mobile viewport height follows the visible keyboard-shrunk viewport', () => {
  assert.equal(resolveMobileViewportHeight(800, 420), 420)
  assert.equal(resolveMobileViewportHeight(800, 900), 800)
  assert.equal(resolveMobileViewportHeight(800, undefined), 800)
  assert.equal(resolveMobileViewportHeight(0, 420), 420)
})
