import test from 'node:test'
import assert from 'node:assert/strict'
import { popupHeightLimit, popupPlacement, popupVerticalPlacement, popupWidth } from '../src/client/popup-geometry-adapter.ts'

test('simple menus fit content and align the nearest anchor edge', () => {
  assert.equal(popupWidth('simple', 86, 40, 360), 144)
  assert.equal(popupWidth('simple', 500, 40, 360), 280)
  assert.deepEqual(popupPlacement({ viewportLeft: 0, viewportWidth: 360, gutter: 12, popupWidth: 144, anchorLeft: 20, anchorRight: 60 }), { left: 20, align: 'start' })
  assert.deepEqual(popupPlacement({ viewportLeft: 0, viewportWidth: 360, gutter: 12, popupWidth: 144, anchorLeft: 300, anchorRight: 340 }), { left: 196, align: 'end' })
})

test('rich menus and composer listboxes remain inside viewport gutters', () => {
  assert.equal(popupWidth('rich', 400, 40, 320), 296)
  assert.equal(popupWidth('listbox', 500, 300, 320), 296)
  const placed = popupPlacement({ viewportLeft: 0, viewportWidth: 320, gutter: 12, popupWidth: 296, anchorLeft: 305, anchorRight: 319 })
  assert.equal(placed.left, 12)
  assert.equal(placed.align, 'end')
})

test('rich model menus stay compact and delegate scrolling internally', () => {
  assert.equal(popupHeightLimit('rich', 800), 360)
  assert.equal(popupHeightLimit('listbox', 320), 179)
  assert.equal(popupHeightLimit('simple', 800), 480)
})

test('tall popups keep both vertical viewport gutters', () => {
  assert.deepEqual(popupVerticalPlacement({
    viewportTop: 0, viewportHeight: 320, gutter: 12,
    popupHeight: 500, anchorTop: 240, anchorBottom: 280, opensAbove: false,
  }), { top: 12, maxHeight: 296 })
  assert.deepEqual(popupVerticalPlacement({
    viewportTop: 0, viewportHeight: 800, gutter: 12,
    popupHeight: 200, anchorTop: 600, anchorBottom: 640, opensAbove: true,
  }), { top: 396, maxHeight: 776 })
})
