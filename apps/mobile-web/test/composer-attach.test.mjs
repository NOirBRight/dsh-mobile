import test from 'node:test'
import assert from 'node:assert/strict'
import {
  attachBusyMessage,
  attachFiles,
  attachUnavailableMessage,
  composerEditor,
  composerSendIsBusy,
  dismissOfficialMenus,
  draftPayload,
  plusMenuAlreadyOpen,
  resolveMobileSendMode,
  unsupportedImageMessage,
} from '../../../packages/ui-layout-mobile/src/client/composer-attach.ts'

function png(name = 'a.png') {
  return new File([Uint8Array.of(1)], name, { type: 'image/png' })
}

test('attachFiles refuses when conversation or inputActions are missing', () => {
  const conversation = { createDraftImages() { return [{ id: 'x' }] } }
  const actions = { addImages() { return true } }
  assert.deepEqual(attachFiles([], conversation, actions), { ok: false, reason: 'empty', message: '' })
  assert.equal(attachFiles([png()], undefined, actions).reason, 'unavailable')
  assert.equal(attachFiles([png()], conversation, undefined).message, attachUnavailableMessage())
})

test('attachFiles appends draft ids and releases them when the composer is busy', () => {
  const released = []
  const conversation = {
    createDraftImages(files) {
      return files.map((file, index) => ({ id: 'draft-' + index + '-' + file.name }))
    },
    releaseDraftImages(images) { released.push(...images.map(image => image.id)) },
  }
  assert.equal(attachFiles([png()], conversation, { addImages: () => true }).ok, true)
  assert.deepEqual(released, [])
  assert.equal(attachFiles([png('b.png')], conversation, { addImages: () => false }).reason, 'busy')
  assert.deepEqual(released, ['draft-0-b.png'])
  assert.equal(attachFiles([png()], conversation, { addImages: () => false }).message, attachBusyMessage())
})

test('attachFiles maps unsupported media types to the official product copy', () => {
  const conversation = {
    createDraftImages() {
      const error = new Error('unsupported image media type: application/pdf')
      error.name = 'UnsupportedImageMediaTypeError'
      throw error
    },
  }
  const outcome = attachFiles([new File([Uint8Array.of(1)], 'a.pdf', { type: 'application/pdf' })], conversation, {
    addImages: () => true,
  })
  assert.equal(outcome.ok, false)
  if (outcome.ok) throw new Error('expected failure')
  assert.equal(outcome.reason, 'unsupported')
  assert.equal(outcome.message, unsupportedImageMessage())
})

test('attachFiles prefers an official drop listener when it preventDefault', () => {
  if (typeof document === 'undefined' || typeof DataTransfer === 'undefined' || typeof DragEvent === 'undefined') return
  const onDrop = (event) => { event.preventDefault() }
  document.addEventListener('drop', onDrop)
  try {
    let created = 0
    const outcome = attachFiles([png()], { createDraftImages() { created += 1; return [{ id: 'x' }] } }, { addImages: () => true })
    assert.equal(outcome.ok, true)
    assert.equal(created, 0)
  } finally {
    document.removeEventListener('drop', onDrop)
  }
})
test('dismissOfficialMenus is safe outside a browser document', () => {
  assert.doesNotThrow(() => dismissOfficialMenus())
})

test('plusMenuAlreadyOpen follows aria-expanded', () => {
  assert.equal(plusMenuAlreadyOpen({ getAttribute: () => 'true' }), true)
  assert.equal(plusMenuAlreadyOpen({ getAttribute: () => 'false' }), false)
  assert.equal(plusMenuAlreadyOpen({ getAttribute: () => null }), false)
})

test('composerEditor ignores non-elements and is the IME target helper', () => {
  assert.equal(composerEditor(null), null)
  assert.equal(composerEditor({}), null)
})

function sendButton({ marked = false, stopLabel = undefined, aria = '发送消息' } = {}) {
  return {
    hasAttribute: (name) => marked && name === 'data-mobile-send-draft',
    dataset: stopLabel === undefined ? {} : { mobileStopLabel: stopLabel },
    getAttribute: (name) => name === 'aria-label' ? aria : null,
  }
}

test('composerSendIsBusy follows the painted Stop seat, not only session.running', () => {
  assert.equal(composerSendIsBusy(sendButton(), false), false)
  assert.equal(composerSendIsBusy(sendButton({ marked: true }), false), true)
  assert.equal(composerSendIsBusy(sendButton({ stopLabel: '停止生成' }), false), true)
  assert.equal(composerSendIsBusy(sendButton(), true), true)
})

test('resolveMobileSendMode follows busyEnter; idle and subagent stay queue', () => {
  assert.equal(resolveMobileSendMode({ busy: false, steeringAvailable: true, busyEnter: 'steer' }), 'queue')
  assert.equal(resolveMobileSendMode({ busy: true, steeringAvailable: false, busyEnter: 'steer' }), 'queue')
  assert.equal(resolveMobileSendMode({ busy: true, steeringAvailable: true, busyEnter: 'steer' }), 'steer')
  assert.equal(resolveMobileSendMode({ busy: true, steeringAvailable: true, busyEnter: 'queue' }), 'queue')
  assert.equal(resolveMobileSendMode({ busy: true, steeringAvailable: true }), 'queue')
})

test('draftPayload prefers live editor text and keeps snapshot image ids', () => {
  assert.deepEqual(
    draftPayload({ textContent: 'from-dom' }, { draft: 'from-store', imageIds: ['a'] }),
    { text: 'from-dom', imageIds: ['a'] },
  )
  assert.deepEqual(
    draftPayload({ textContent: '' }, { draft: 'from-store', imageIds: ['a'] }),
    { text: 'from-store', imageIds: ['a'] },
  )
  assert.deepEqual(draftPayload({ textContent: 'from-dom' }), { text: 'from-dom', imageIds: [] })
})
