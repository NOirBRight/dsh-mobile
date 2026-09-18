import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  SkillCubeIcon,
  decorateSlashSource,
  installSlashMenuIcon,
  stampSlashOptionIcon,
  withDefaultSlashIcon,
} from '../../../packages/ui-layout-mobile/src/client/skill-menu-icon.ts'

test('withDefaultSlashIcon stamps the cube only when icon is missing', () => {
  const stamped = withDefaultSlashIcon({ name: 'ponytail', description: 'x' })
  assert.equal(stamped.icon, SkillCubeIcon)
  const kept = withDefaultSlashIcon({ name: 'goal', icon: 'keep' })
  assert.equal(kept.icon, 'keep')
})

test('decorateSlashSource wraps skill sources and skips command and @', async () => {
  const at = {
    trigger: '@',
    name: 'file',
    candidates: async () => [{ name: 'readme' }],
  }
  decorateSlashSource(at)
  assert.equal((await at.candidates())[0].icon, undefined)

  const command = {
    trigger: '/',
    name: 'command',
    candidates: async () => [{ name: 'plan' }, { name: 'ponytail' }],
  }
  decorateSlashSource(command)
  const commandRows = await command.candidates()
  assert.equal(commandRows[0].icon, undefined)
  assert.equal(commandRows[1].icon, undefined)

  let calls = 0
  const skill = {
    trigger: '/',
    name: 'skill',
    candidates: async () => {
      calls += 1
      return [{ name: 'ask-matt' }, { name: 'kept', icon: 'file' }]
    },
  }
  decorateSlashSource(skill)
  decorateSlashSource(skill)
  const rows = await skill.candidates()
  assert.equal(calls, 1)
  assert.equal(rows[0].icon, SkillCubeIcon)
  assert.equal(rows[1].icon, 'file')
})

test('installSlashMenuIcon wraps future registrations and live slash sources', async () => {
  const live = [{
    trigger: '/',
    name: 'skill',
    candidates: async () => [{ name: 'live' }],
  }]
  const service = {
    live: { sources: live },
    registerSource(src) {
      return () => { void src }
    },
  }
  const restore = installSlashMenuIcon(service)
  assert.equal((await live[0].candidates())[0].icon, SkillCubeIcon)
  const incoming = {
    trigger: '/',
    name: 'command',
    candidates: async () => [{ name: 'plan' }],
  }
  service.registerSource(incoming)
  assert.equal((await incoming.candidates())[0].icon, undefined)
  const skillIncoming = {
    trigger: '/',
    name: 'skill',
    candidates: async () => [{ name: 'new' }],
  }
  service.registerSource(skillIncoming)
  assert.equal((await skillIncoming.candidates())[0].icon, SkillCubeIcon)
  restore()
  const later = {
    trigger: '/',
    name: 'skill',
    candidates: async () => [{ name: 'after' }],
  }
  service.registerSource(later)
  assert.equal((await later.candidates())[0].icon, undefined)
})

test('stampSlashOptionIcon prepends a cube only when the row has no SVG', () => {
  if (typeof document === 'undefined') return
  const menu = document.createElement('div')
  menu.setAttribute('data-trigger-menu', '')
  const bare = document.createElement('button')
  bare.setAttribute('role', 'option')
  bare.id = 'dsh-slash-option-command-8'
  const owned = document.createElement('button')
  owned.setAttribute('role', 'option')
  owned.append(document.createElementNS('http://www.w3.org/2000/svg', 'svg'))
  menu.append(bare, owned)
  stampSlashOptionIcon(bare)
  stampSlashOptionIcon(owned)
  assert.equal(bare.querySelector('[data-mobile-menu-icon]') !== null, true)
  assert.equal(owned.querySelector('[data-mobile-menu-icon]'), null)
  stampSlashOptionIcon(bare)
  assert.equal(bare.querySelectorAll('[data-mobile-menu-icon]').length, 1)
  const raced = document.createElement('button')
  raced.setAttribute('role', 'option')
  menu.append(raced)
  stampSlashOptionIcon(raced)
  assert.equal(raced.querySelector('[data-mobile-menu-icon]') !== null, true)
  const official = document.createElement('span')
  official.setAttribute('aria-hidden', 'true')
  official.append(document.createElementNS('http://www.w3.org/2000/svg', 'svg'))
  raced.append(official)
  stampSlashOptionIcon(raced)
  assert.equal(raced.querySelector('[data-mobile-menu-icon]'), null)
})

test('phone layout CSS sizes the injected cube seat and does not paint a second skill-id glyph', async () => {
  const css = await readFile(
    resolve(import.meta.dirname, '../../../packages/ui-layout-mobile/src/client/MobileFrame.module.css'),
    'utf8',
  )
  assert.equal(css.includes('[data-mobile-menu-icon]'), true)
  assert.equal(css.includes('[id^="dsh-slash-option-skill-"]'), false)
  assert.equal(css.includes('[id^="dsh-slash-option-command-"]'), false)
})
