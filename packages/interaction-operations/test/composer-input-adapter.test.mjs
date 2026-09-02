import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { mobileEnterAction } from '../src/client/composer-input-adapter.ts'

const base = {
  key: 'Enter', trusted: true, editable: true, composing: false,
  legacyKeyCode: 13, shift: false, control: false, meta: false, alt: false,
  selectionPopupOpen: false,
}

test('adapter targets the Alpha.4 contenteditable composer instead of only legacy textarea', async () => {
  const source = await readFile(resolve(import.meta.dirname, '../src/client/composer-input-adapter.ts'), 'utf8')
  assert.match(source, /\[data-composer-input\]\[data-phase\]/)
  assert.match(source, /contenteditable/)
})

test('trusted plain mobile Enter remains a newline', () => {
  assert.equal(mobileEnterAction(base), 'newline')
})

test('explicit accelerated shortcut remains upstream-owned', () => {
  assert.equal(mobileEnterAction({ ...base, control: true }), 'upstream')
  assert.equal(mobileEnterAction({ ...base, meta: true }), 'upstream')
})

test('IME and open selection popups keep their upstream Enter behavior', () => {
  assert.equal(mobileEnterAction({ ...base, composing: true }), 'upstream')
  assert.equal(mobileEnterAction({ ...base, legacyKeyCode: 229 }), 'upstream')
  assert.equal(mobileEnterAction({ ...base, selectionPopupOpen: true }), 'upstream')
})

test('synthetic Enter used by the mobile send button is not intercepted', () => {
  assert.equal(mobileEnterAction({ ...base, trusted: false }), 'upstream')
})
