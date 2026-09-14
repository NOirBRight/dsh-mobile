import test from 'node:test'
import assert from 'node:assert/strict'
import { coldStartPresentation } from '../../../packages/ui-layout-mobile/src/client/cold-start-presentation.ts'

const VISIBLE_TEXTS = new Set(['连接中…', '重连中…', '同步中…', '同步失败'])

function present(overrides = {}) {
  return coldStartPresentation({
    status: 'connecting',
    shellMounted: true,
    liveDataReady: 'pending',
    accountsOwnBaselines: true,
    listBaseline: 'pending',
    windowBaseline: 'pending',
    hasListSnapshot: false,
    hasWindowSnapshot: false,
    ...overrides,
  })
}

function assertVisibleChip(view, text) {
  assert.equal(view.chip.visible, true)
  assert.equal(view.chip.text, text)
  assert.equal(VISIBLE_TEXTS.has(view.chip.text), true)
}

test('unmounted shell keeps the floating chip invisible', () => {
  const view = present({ status: 'connecting', shellMounted: false })
  assert.equal(view.chip.visible, false)
  assert.equal(view.chip.text, '连接中…')
})

test('terminal recovery hides the chip so the topbar can own the QR scan', () => {
  const view = present({
    status: { phase: 'terminal', attempt: 1, route: 'tunnel', error: 'bad-token' },
    route: 'Tunnel',
  })
  assert.equal(view.chip.visible, false)
  assert.notEqual(view.chip.text, '重连中…')
})

test('first tunnel handshake shows 连接中 and locks the composer', () => {
  const view = present({ status: 'connecting' })
  assertVisibleChip(view, '连接中…')
  assert.equal(view.composerLocked, true)
})

test('passive retry shows 重连中 without stacking a second chip', () => {
  const view = present({
    status: { phase: 'retry-wait', attempt: 4, retryInMs: 8000, route: 'tunnel', error: 'network unavailable' },
    route: 'Tunnel',
  })
  assertVisibleChip(view, '重连中…')
  assert.equal(view.composerLocked, true)
})

test('a reconnecting handshake is 重连中 not 连接中', () => {
  const view = present({
    status: { phase: 'connecting', attempt: 2, reconnecting: true, route: 'tunnel' },
  })
  assertVisibleChip(view, '重连中…')
})

test('closed transport is 重连中', () => {
  const view = present({ status: 'closed', route: 'Tunnel Fallback' })
  assertVisibleChip(view, '重连中…')
})

test('open tunnel with pending product baselines is 同步中 and covers official empty seats', () => {
  const view = present({
    status: 'open',
    shellMounted: true,
    accountsOwnBaselines: true,
    listBaseline: 'pending',
    windowBaseline: 'pending',
    hasListSnapshot: false,
    hasWindowSnapshot: false,
  })
  assertVisibleChip(view, '同步中…')
  assert.equal(view.listOverlay, true)
  assert.equal(view.conversationOverlay, true)
  assert.equal(view.composerLocked, true)
})

test('open tunnel plus mounted shell must not hide the chip by itself', () => {
  const view = present({
    status: 'open',
    shellMounted: true,
    liveDataReady: 'core-ready',
    accountsOwnBaselines: true,
    listBaseline: 'pending',
    windowBaseline: 'pending',
  })
  assertVisibleChip(view, '同步中…')
})

test('core-ready is not session-ready even when the wrapper used to hide on it', () => {
  const view = present({
    status: { phase: 'open', attempt: 1, route: 'direct' },
    liveDataReady: 'core-ready',
    accountsOwnBaselines: false,
    listBaseline: 'pending',
    windowBaseline: 'pending',
  })
  assertVisibleChip(view, '同步中…')
})

test('baseline error shows 同步失败 and keeps overlays only when snapshots exist', () => {
  const withSnapshots = present({
    status: 'open',
    listBaseline: 'error',
    windowBaseline: 'error',
    hasListSnapshot: true,
    hasWindowSnapshot: true,
  })
  assertVisibleChip(withSnapshots, '同步失败')
  assert.equal(withSnapshots.listOverlay, true)
  assert.equal(withSnapshots.conversationOverlay, true)
  assert.equal(withSnapshots.composerLocked, true)

  const withoutSnapshots = present({
    status: 'open',
    listBaseline: 'error',
    windowBaseline: 'error',
    hasListSnapshot: false,
    hasWindowSnapshot: false,
  })
  assertVisibleChip(withoutSnapshots, '同步失败')
  assert.equal(withoutSnapshots.listOverlay, false)
  assert.equal(withoutSnapshots.conversationOverlay, false)
  assert.equal(withoutSnapshots.composerLocked, true)
})

test('official live-data ready hides the chip without showing 已连接', () => {
  const view = present({
    status: 'open',
    liveDataReady: 'ready',
    accountsOwnBaselines: false,
    listBaseline: 'pending',
    windowBaseline: 'pending',
  })
  assert.equal(view.chip.visible, false)
  assert.notEqual(view.chip.text, '同步中…')
  if (view.chip.visible) assert.notEqual(view.chip.text, '已连接')
  assert.equal(view.listOverlay, true)
  assert.equal(view.conversationOverlay, true)
  assert.equal(view.composerLocked, true)
})

test('both product baselines ready hide the chip and unlock the composer', () => {
  const view = present({
    status: 'open',
    liveDataReady: 'core-ready',
    accountsOwnBaselines: true,
    listBaseline: 'ready',
    windowBaseline: 'ready',
  })
  assert.equal(view.chip.visible, false)
  if (view.chip.visible) assert.notEqual(view.chip.text, '已连接')
  assert.equal(view.listOverlay, false)
  assert.equal(view.conversationOverlay, false)
  assert.equal(view.composerLocked, false)
})

test('list can yield while the conversation overlay stays until its window arrives', () => {
  const view = present({
    status: 'open',
    listBaseline: 'ready',
    windowBaseline: 'pending',
    hasListSnapshot: true,
    hasWindowSnapshot: true,
  })
  assertVisibleChip(view, '同步中…')
  assert.equal(view.listOverlay, false)
  assert.equal(view.conversationOverlay, true)
  assert.equal(view.composerLocked, true)
})

test('a new generation with pending baselines covers again after a ready cycle', () => {
  const ready = present({
    status: 'open',
    listBaseline: 'ready',
    windowBaseline: 'ready',
  })
  assert.equal(ready.chip.visible, false)
  assert.equal(ready.composerLocked, false)

  const remounted = present({
    status: 'open',
    listBaseline: 'pending',
    windowBaseline: 'pending',
  })
  assertVisibleChip(remounted, '同步中…')
  assert.equal(remounted.listOverlay, true)
  assert.equal(remounted.conversationOverlay, true)
  assert.equal(remounted.composerLocked, true)
})

test('visible chip copy is only the four product phrases', () => {
  const samples = [
    present({ status: 'connecting' }),
    present({ status: 'closed' }),
    present({ status: 'open' }),
    present({ status: 'open', listBaseline: 'error', windowBaseline: 'ready' }),
    present({
      status: { phase: 'connecting', attempt: 3, reconnecting: true, route: 'tunnel' },
    }),
  ]
  for (const view of samples) {
    if (!view.chip.visible) continue
    assert.equal(VISIBLE_TEXTS.has(view.chip.text), true, view.chip.text)
    assert.equal(['刷新中…', '刷新失败', '已连接'].includes(view.chip.text), false)
  }
})
