import test from 'node:test'
import assert from 'node:assert/strict'
import { dismissOfficialTeamDialog, isOfficialTeamDialog } from '../../../packages/ui-layout-mobile/src/client/team-panel-presenter.ts'

test('Agent Team dialog is the role=dialog nested in data-team-action', () => {
  const dialog = {
    getAttribute(name) { return name === 'role' ? 'dialog' : null },
    closest(selector) { return selector === '[data-team-action]' ? {} : null },
  }
  assert.equal(isOfficialTeamDialog(dialog), true)
  assert.equal(isOfficialTeamDialog({
    getAttribute(name) { return name === 'role' ? 'dialog' : null },
    closest() { return null },
  }), false)
  assert.equal(isOfficialTeamDialog({
    getAttribute() { return null },
    closest(selector) { return selector === '[data-team-action]' ? {} : null },
  }), false)
})

test('dismissOfficialTeamDialog clicks only the expanded Team trigger', () => {
  const clicks = []
  const expanded = { click() { clicks.push('open') } }
  const collapsed = { click() { clicks.push('closed') } }
  dismissOfficialTeamDialog({
    querySelectorAll(selector) {
      return selector === '[data-team-action] > button[aria-expanded="true"]' ? [expanded] : [collapsed, expanded]
    },
  })
  assert.deepEqual(clicks, ['open'])
})

test('dismissOfficialTeamDialog is a no-op when Agent Team is already closed', () => {
  dismissOfficialTeamDialog({
    querySelectorAll() { return [] },
  })
})
