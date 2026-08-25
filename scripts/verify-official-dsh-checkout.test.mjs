import assert from 'node:assert/strict'
import test from 'node:test'

import { assessOfficialDshCheckout } from './verify-official-dsh-checkout.mjs'

const official = 'https://github.com/deepseek-ai/deepseek-harness.git'
const revision = 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'

test('accepts a clean checkout from the official repository', () => {
  assert.deepEqual(assessOfficialDshCheckout({
    remote: official,
    status: '',
    head: revision,
    expectedRevision: revision,
  }), { ok: true, revision })
})

test('rejects a dirty official checkout', () => {
  assert.deepEqual(assessOfficialDshCheckout({
    remote: official,
    status: ' M packages/plan/plan-mode/src/index.ts',
    head: revision,
    expectedRevision: revision,
  }), {
    ok: false,
    reasons: ['official DSH checkout has local changes'],
  })
})

test('rejects a fork remote and unexpected revision together', () => {
  assert.deepEqual(assessOfficialDshCheckout({
    remote: 'git@github.com:NOirBRight/deepseek-harness.git',
    status: '',
    head: '528c682e061696f5a160f363f236ecbf53cbd006',
    expectedRevision: revision,
  }), {
    ok: false,
    reasons: [
      'origin is not deepseek-ai/deepseek-harness',
      'official DSH revision does not match the required baseline',
    ],
  })
})

test('accepts the canonical ssh transport for the official repository', () => {
  assert.deepEqual(assessOfficialDshCheckout({
    remote: 'ssh://git@github.com/deepseek-ai/deepseek-harness.git',
    status: '',
    head: revision,
  }), { ok: true, revision })
})

test('pins the official rc.2 baseline when no override is supplied', () => {
  assert.deepEqual(assessOfficialDshCheckout({
    remote: 'git@github.com:deepseek-ai/deepseek-harness.git',
    status: '',
    head: '528c682e061696f5a160f363f236ecbf53cbd006',
  }), {
    ok: false,
    reasons: ['official DSH revision does not match the required baseline'],
  })
})
