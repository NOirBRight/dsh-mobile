import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { assessOfficialDshCheckout } from './verify-official-dsh-checkout.mjs'

const official = 'https://github.com/deepseek-ai/deepseek-harness.git'
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const revision = 'cd5ef8148158c3a752a658978873241fdf8e2bbc'
const tag = 'dsh-v0.1.2-alpha.1'

test('every active build consumer uses the prepared upstream checkout', async () => {
  const consumers = [
    'build/tsdown.client.ts',
    'apps/mobile-web/vite.config.ts',
    'apps/mobile-web/tsconfig.json',
    'apps/mobile-web/scripts/build-local-host-bridge.mjs',
    'apps/mobile-web/scripts/package-local-shell.mjs',
    'scripts/prepare-upstream.mjs',
    'scripts/verify-official-dsh-checkout.mjs',
    'scripts/verification-workflows.mjs',
  ]
  for (const path of consumers) {
    const source = await readFile(resolve(repositoryRoot, path), 'utf8')
    assert.match(source, /\.dsh-upstream/, path)
    if (!path.endsWith('prepare-upstream.mjs')) {
      assert.doesNotMatch(source, /(?:\.\.\/)+(?:dsh-wt-02|deepseek-harness)/, path)
    }
    if (path.endsWith('build-local-host-bridge.mjs')) {
      assert.doesNotMatch(source, /spawn|tsdown/, 'mobile packaging must not rebuild or mutate official DSH')
    }
    if (path.endsWith('prepare-upstream.mjs')) {
      assert.match(source, /realpathSync/, 'an explicit symlink path must resolve before replacing .dsh-upstream')
      assert.match(source, /unlinkSync\(link\)/, 'an existing .dsh-upstream symlink must be unlinked directly')
      assert.doesNotMatch(source, /rmSync/, 'upstream symlink replacement must not recursively remove a link')
    }
  }
})

test('accepts a clean checkout from the official repository', () => {
  assert.deepEqual(assessOfficialDshCheckout({
    remote: official,
    status: '',
    head: revision,
    tag,
  }), { ok: true, revision })
})

test('rejects a dirty official checkout', () => {
  assert.deepEqual(assessOfficialDshCheckout({
    remote: official,
    status: ' M packages/example/src/index.ts',
    head: revision,
    tag,
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
    tag,
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
    tag,
  }), { ok: true, revision })
})

test('pins the official v0.1.2-alpha.1 baseline when no override is supplied', () => {
  assert.deepEqual(assessOfficialDshCheckout({
    remote: 'git@github.com:deepseek-ai/deepseek-harness.git',
    status: '',
    head: '528c682e061696f5a160f363f236ecbf53cbd006',
    tag,
  }), {
    ok: false,
    reasons: ['official DSH revision does not match the required baseline'],
  })
})

test('rejects the required revision without the exact release tag', () => {
  assert.deepEqual(assessOfficialDshCheckout({
    remote: official,
    status: '',
    head: revision,
    tag: 'v0.1.2-alpha.1',
  }), {
    ok: false,
    reasons: ['official DSH checkout is not exactly tagged dsh-v0.1.2-alpha.1'],
  })
})
