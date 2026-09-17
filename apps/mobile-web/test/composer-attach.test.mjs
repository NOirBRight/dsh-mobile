import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  composerCardSendSeat,
  composerDraftActionButton,
  composerEditor,
  composerSecondarySeat,
  dismissOfficialMenus,
  isComposerKeepFocusSeat,
  silencePlusKeepFocus,
} from '../../../packages/ui-layout-mobile/src/client/composer-attach.ts'
test('dismissOfficialMenus is safe outside a browser document', () => {
  assert.doesNotThrow(() => dismissOfficialMenus())
})

test('silencePlusKeepFocus cancels keepFocus on the official plus without swallowing non-plus events', () => {
  if (typeof document === 'undefined' || typeof MouseEvent === 'undefined') return
  const card = document.createElement('div')
  card.setAttribute('data-composer-card', '')
  const plus = document.createElement('button')
  plus.setAttribute('aria-haspopup', 'listbox')
  card.append(plus)
  document.body.append(card)
  try {
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'target', { value: plus })
    let stopped = false
    event.stopImmediatePropagation = () => { stopped = true }
    assert.equal(silencePlusKeepFocus(event), true)
    assert.equal(event.defaultPrevented, false, 'canceled pointerdown swallows the plus click on Android')
    assert.equal(stopped, true)
    assert.equal(document.activeElement, plus)
    const other = document.createElement('button')
    card.append(other)
    const skipped = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    Object.defineProperty(skipped, 'target', { value: other })
    assert.equal(silencePlusKeepFocus(skipped), false)
    assert.equal(skipped.defaultPrevented, false)
  } finally {
    card.remove()
  }
})

test('composerEditor ignores non-elements and is the IME target helper', () => {
  assert.equal(composerEditor(null), null)
  assert.equal(composerEditor({}), null)
})

test('keepFocus seats are send/stop, never permission/plan/model (plus is gated earlier)', () => {
  const stop = seatButton({ aria: '停止生成' })
  const send = seatButton({ aria: '发送消息' })
  const repaintedStop = seatButton({ aria: '发送消息', stopLabel: '停止生成' })
  const permission = seatButton({ aria: 'Access mode, current: Full access' })
  const plan = seatButton({ aria: 'plan mode 已关闭，按下开启' })
  const model = seatButton({ aria: 'Select model, current Test Model' })
  assert.equal(isComposerKeepFocusSeat(stop), true)
  assert.equal(isComposerKeepFocusSeat(send), true)
  // A repainted Stop keeps the interrupt seat even when its glyph reads Send.
  assert.equal(isComposerKeepFocusSeat(repaintedStop), true)
  assert.equal(isComposerKeepFocusSeat(permission), false)
  assert.equal(isComposerKeepFocusSeat(plan), false)
  assert.equal(isComposerKeepFocusSeat(model), false)
})

function seatButton({ aria = '发送消息', stopLabel = undefined, disabled = false } = {}) {
  return {
    dataset: stopLabel === undefined ? {} : { mobileStopLabel: stopLabel },
    getAttribute: (name) => name === 'aria-label' ? aria : null,
    disabled,
  }
}

function seatCard(buttons) {
  return { querySelectorAll: () => buttons }
}

test('composerCardSendSeat finds the genuine Send seat and ignores repainted Stops', () => {
  const send = seatButton({ aria: '发送消息' })
  const stop = seatButton({ aria: '停止生成' })
  assert.equal(composerCardSendSeat(seatCard([send])), send)
  assert.equal(composerCardSendSeat(seatCard([send, stop])), send)
  assert.equal(composerCardSendSeat(seatCard([stop])), null)
  assert.equal(composerCardSendSeat(seatCard([])), null)
  const repainted = seatButton({ aria: '发送消息', stopLabel: '停止生成' })
  assert.equal(composerCardSendSeat(seatCard([repainted])), null)
  assert.equal(composerCardSendSeat(seatCard([repainted, send])), send)
})

test('composerDraftActionButton ignores a repainted Stop even with a draft', () => {
  const card = {
    querySelectorAll: (selector) => selector === 'button[aria-label]' ? [draftStopButton] : [],
    querySelector: (selector) => {
      if (selector === 'textarea') return null
      if (selector === '[data-composer-input]') return { textContent: 'follow-up' }
      if (selector === '[role="group"] img') return null
      return null
    },
  }
  const draftStopButton = {
    tagName: 'BUTTON',
    dataset: { mobileStopLabel: '停止生成' },
    getAttribute: (name) => name === 'aria-label' ? '发送消息' : null,
    closest: (selector) => {
      if (selector === 'button') return draftStopButton
      if (selector === '[data-composer-card]') return card
      return null
    },
  }
  assert.equal(
    composerDraftActionButton(draftStopButton),
    null,
    'a repainted Stop keeps its interrupt role and must not enter the send path',
  )
})

test('composerSecondarySeat hides one seat when Send and Stop coexist', () => {
  const disabledSend = seatButton({ aria: '发送消息', disabled: true })
  const enabledStop = seatButton({ aria: '停止生成', disabled: false })
  assert.equal(composerSecondarySeat(seatCard([disabledSend, enabledStop])), disabledSend)
  const enabledSend = seatButton({ aria: '发送消息', disabled: false })
  assert.equal(composerSecondarySeat(seatCard([enabledSend, enabledStop])), enabledStop)
  assert.equal(composerSecondarySeat(seatCard([
    disabledSend,
    seatButton({ aria: '停止生成', disabled: true }),
  ])), disabledSend, 'both disabled mid-interrupt still hides the unusable Send')
  assert.equal(composerSecondarySeat(seatCard([enabledSend])), null, 'a lone Send is never secondary')
  assert.equal(composerSecondarySeat(seatCard([enabledStop])), null, 'a lone Stop is never secondary')
  assert.equal(composerSecondarySeat(seatCard([])), null)
})

test('narrow plus lets the official listbox open; ComposerAttach does not own a file or image menu', async () => {
  const attachPath = resolve(import.meta.dirname, '../../../packages/ui-layout-mobile/src/client/ComposerAttach.tsx')
  const source = await readFile(attachPath, 'utf8')
  assert.doesNotMatch(source, /id: 'command'/)
  assert.doesNotMatch(source, /id: 'image'/)
  assert.doesNotMatch(source, /installOfficialFileCommandRowHider/)
  assert.match(source, /silencePlusKeepFocus/)
  assert.match(source, /data-mobile-attach-seat/)
})
