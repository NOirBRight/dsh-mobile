import test from 'node:test'
import assert from 'node:assert/strict'
import {
  asPlan,
  commandsExecuteFrom,
  interpretPlanCommandResult,
  planClickCommand,
  planCommand,
  planTarget,
  planToggleAria,
  planToggleDisabled,
} from '../../../packages/ui-layout-mobile/src/client/plan-toggle.ts'

test('plan target folds a pending flip as the next state', () => {
  assert.equal(planTarget({ active: false, pending: false }), false)
  assert.equal(planTarget({ active: true, pending: false }), true)
  assert.equal(planTarget({ active: false, pending: true }), true)
  assert.equal(planTarget({ active: true, pending: true }), false)
})

test('plan command maps on to /plan and off to /plan off', () => {
  assert.equal(planCommand(true), '/plan')
  assert.equal(planCommand(false), '/plan off')
})

test('asPlan rejects incomplete host values', () => {
  assert.equal(asPlan(undefined), undefined)
  assert.equal(asPlan({ active: true }), undefined)
  assert.deepEqual(asPlan({ active: false, pending: true }), { active: false, pending: true })
})

test('plan command results surface host failures', () => {
  assert.equal(interpretPlanCommandResult('/plan', { ok: true, value: { kind: 'success' } }), null)
  assert.equal(interpretPlanCommandResult('/plan off', { ok: true }), 'unknown command: /plan off')
  assert.equal(
    interpretPlanCommandResult('/plan', { ok: false, error: { message: 'busy', code: 'LOCKED' } }),
    'busy (LOCKED)',
  )
})

test('plan toggle aria follows document language', () => {
  assert.match(planToggleAria(true, 'zh-CN'), /已开启/)
  assert.match(planToggleAria(false, 'en'), /off, press to turn on/i)
})

test('commandsExecuteFrom reads remote.commands.execute', () => {
  const execute = async () => ({ ok: true, value: {} })
  assert.equal(commandsExecuteFrom({ remote: { commands: { execute } } }), execute)
  assert.equal(commandsExecuteFrom({ remote: {} }), undefined)
})

test('ListTodo icon matches lucide-react-native 0.546 geometry', async () => {
  const { readFile } = await import('node:fs/promises')
  const { fileURLToPath } = await import('node:url')
  const src = await readFile(fileURLToPath(new URL('../../../packages/ui-layout-mobile/src/client/PlanToggle.tsx', import.meta.url)), 'utf8')
  assert.match(src, /viewBox="0 0 24 24"/)
  assert.match(src, /<rect x="3" y="4" width="6" height="6" rx="1"/)
  assert.match(src, /d="m3 17 2 2 4-4"/)
  assert.match(src, /d="M13 5h8M13 12h8M13 19h8"/)
  assert.doesNotMatch(src, /M13 7h8/)
})

function click(plan, locked, rpcInFlight) {
  if (planToggleDisabled(locked, rpcInFlight)) return null
  return planClickCommand(plan)
}

test('queued entering while running reverses with /plan off; idle stays a simple toggle', () => {
  const idleOff = { active: false, pending: false }
  const queuedEnter = { active: false, pending: true }
  const idleOn = { active: true, pending: false }
  const queuedLeave = { active: true, pending: true }

  assert.equal(click(idleOff, false, false), '/plan')
  assert.equal(click(queuedEnter, false, true), null)
  assert.equal(planTarget(queuedEnter), true)
  assert.equal(click(queuedEnter, false, false), '/plan off')
  assert.equal(click(idleOff, false, false), '/plan')

  assert.equal(click(idleOn, false, false), '/plan off')
  assert.equal(click(queuedLeave, false, false), '/plan')
  assert.equal(click(queuedEnter, true, false), null)
  assert.equal(click(idleOff, true, false), null)
})

test('host pending does not disable; locked and in-flight execute do', () => {
  assert.equal(planToggleDisabled(false, false), false)
  assert.equal(planToggleDisabled(true, false), true)
  assert.equal(planToggleDisabled(false, true), true)
  assert.equal(planToggleDisabled(true, true), true)
})

test('PlanToggle click uses folded target and official disable inputs', async () => {
  const { readFile } = await import('node:fs/promises')
  const { fileURLToPath } = await import('node:url')
  const src = await readFile(fileURLToPath(new URL('../../../packages/ui-layout-mobile/src/client/PlanToggle.tsx', import.meta.url)), 'utf8')
  assert.match(src, /planToggleDisabled\(locked, leaving\)/)
  assert.match(src, /planClickCommand\(plan\)/)
  assert.doesNotMatch(src, /plan\.pending \|\| leaving/)
  assert.match(src, /planTarget\(plan\)/)
  assert.match(src, /css\.on/)
})
