import test from 'node:test'
import assert from 'node:assert/strict'
import {
  directChildByTag,
  isOfficialSettingsDialog,
} from '../../../packages/ui-layout-mobile/src/client/settings-shell-presenter.ts'

function el(tag, attrs = {}, children = []) {
  return {
    tagName: tag.toUpperCase(),
    children,
    getAttribute(name) { return attrs[name] ?? null },
    hasAttribute(name) { return Object.hasOwn(attrs, name) },
  }
}

test('official settings dialog is the aria-modal panel whose direct child is nav', () => {
  const nav = el('nav')
  const dialog = el('div', { role: 'dialog', 'aria-modal': 'true' }, [nav])
  assert.equal(directChildByTag(dialog, 'nav'), nav)
  assert.equal(isOfficialSettingsDialog(dialog), true)
  assert.equal(isOfficialSettingsDialog(el('div', { role: 'dialog', 'aria-modal': 'true' }, [el('div')])), false)
  assert.equal(isOfficialSettingsDialog(el('div', { role: 'dialog' }, [nav])), false)
})
