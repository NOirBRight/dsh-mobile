import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { appendFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'

import {
  aggregateErrors,
  assertBootEntries,
  assertOfficialCliDigest,
  assertPublishableManifest,
  assertStrictPairingPolicy,
  captureOfficialCoreRoster,
  assertUnchanged,
  fetchText,
  inspectPackedArtifact,
  inspectPairingArtifact,
  run,
  sanitizedChildEnv,
  sha256File,
  spawnChild,
  stopChild,
  waitForProfileUrl,
} from './mobile-matrix.mjs'
import { requireNoFollowFlag, resolvePairingManifestStrict } from './pairing-artifact-resolver.mjs'
import { assertFreshOfficialCli } from './verify-official-dsh-checkout.mjs'

const root = resolve(new URL('..', import.meta.url).pathname)
const strictPath = resolve(root, 'scripts/verify-clean-alpha1-mobile-matrix.mjs')
const devPath = resolve(root, 'scripts/verify-clean-alpha1-mobile-matrix.dev.mjs')
const sharedPath = resolve(root, 'scripts/verification-workflows.mjs')
const strictPairingPath = resolve(root, 'scripts/verify-pairing-artifact.mjs')
const devPairingPath = resolve(root, 'scripts/verify-pairing-artifact.dev.mjs')
const strictTwoTierPath = resolve(root, 'scripts/verify-two-tier-compatibility.mjs')
const devTwoTierPath = resolve(root, 'scripts/verify-two-tier-compatibility.dev.mjs')
const resolverPath = resolve(root, 'scripts/pairing-artifact-resolver.mjs')
const packagePath = resolve(root, 'package.json')
const evidenceDocPath = resolve(root, 'docs/issue-3-implementation-evidence.md')
const workflowDocPath = resolve(root, 'docs/pairing-release-workflow.md')
const archivedEnhancementPath = resolve(root, 'docs/archived/enhancement-seams.md')
const archivedAuditPath = resolve(root, 'docs/archived/plugin-decoupling-audit.md')
const archivedReviewPath = resolve(root, 'docs/archived/published-plugin-coupling-review-2026-08-26.md')
const muxServicePath = resolve(root, 'deploy/am01s/dsh-pair-mux.service')
const activeScripts = [
  'mobile-matrix.mjs',
  'pairing-artifact-resolver.mjs',
  'verify-clean-alpha1-mobile-matrix.mjs',
  'verify-clean-alpha1-mobile-matrix.dev.mjs',
  'verification-workflows.mjs',
  'verify-official-dsh-checkout.mjs',
  'verify-pairing-artifact.mjs',
  'verify-pairing-artifact.dev.mjs',
  'verify-two-tier-compatibility.mjs',
  'verify-two-tier-compatibility.dev.mjs',
]

function cleanEnv() {
  return {
    ...process.env,
    MOBILE_PAIRING_TARBALL: undefined,
    MOBILE_PAIRING_SHA256: undefined,
    MOBILE_PAIRING_ROOT: undefined,
  }
}

function encoded(...bytes) {
  return String.fromCodePoint(...bytes)
}

const forbiddenProtocolStrings = [
  encoded(80, 108, 97, 110),
  encoded(69, 120, 116, 101, 114, 110, 97, 108),
  encoded(67, 111, 109, 112, 111, 115, 101, 114),
  encoded(80, 114, 111, 118, 105, 100, 101, 114),
  encoded(99, 111, 110, 118, 101, 114, 115, 97, 116, 105, 111, 110, 46, 99, 111, 109, 112, 111, 115, 101, 114),
  encoded(69, 88, 84, 69, 82, 78, 65, 76, 95, 80, 76, 65, 78),
  encoded(100, 115, 104, 45, 99, 111, 109, 112, 111, 115, 101, 114, 45, 112, 105, 99, 107, 101, 114),
  encoded(100, 115, 104, 45, 101, 120, 116, 101, 114, 110, 97, 108, 45, 97, 103, 101, 110, 116, 115),
]

function spawnStrict(extra = {}) {
  return spawnSync(process.execPath, [strictPath], {
    env: sanitizedChildEnv({ ...cleanEnv(), ...extra }),
    encoding: 'utf8',
  })
}

async function createSyntheticPairingArchive(manifest, extraEntries = [], includeStrictEntries = false) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-mobile-pairing-manifest-test-'))
  const packageDirectory = join(directory, 'package')
  const archive = join(directory, 'pairing.tgz')
  const requiredEntries = includeStrictEntries
    ? ['lib/index.js', 'lib/index.d.ts', 'lib/client.js', 'lib/mux-cli.js', 'cordis.patch.yml']
    : ['lib/index.js']
  await mkdir(join(packageDirectory, 'lib'), { recursive: true })
  await writeFile(join(packageDirectory, 'package.json'), JSON.stringify(manifest))
  for (const entry of requiredEntries) {
    const path = join(packageDirectory, entry)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, entry === 'cordis.patch.yml' ? 'patch: []\n' : 'export {}\n')
  }
  for (const entry of extraEntries) {
    const path = join(packageDirectory, entry)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, 'credential material\n')
  }
  const packed = spawnSync('tar', [
    '-czf', archive,
    '-C', directory,
    'package/package.json',
    ...requiredEntries.map(entry => 'package/' + entry),
    ...extraEntries.map(entry => 'package/' + entry),
  ], { encoding: 'utf8', env: sanitizedChildEnv() })
  assert.equal(packed.status, 0, packed.stderr)
  return { archive, directory }
}

function strictPairingManifest(overrides = {}) {
  return {
    name: '@dsh-mobile/pairing',
    version: '0.1.12',
    main: 'lib/index.js',
    types: 'lib/index.d.ts',
    exports: {
      '.': { types: './lib/index.d.ts', default: './lib/index.js' },
      './client': './lib/client.js',
      './package.json': './package.json',
    },
    bin: { 'dsh-pair-mux': './lib/mux-cli.js' },
    dsh: { bundle: { patch: './cordis.patch.yml' } },
    dependencies: { '@dsh-mobile/e2e-tunnel': 'github:NOirBRight/dsh-e2e-tunnel#v0.1.4' },
    ...overrides,
  }
}

function withEnvironment(values, callback) {
  const previous = {}
  for (const [name, value] of Object.entries(values)) {
    previous[name] = process.env[name]
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  try {
    return callback()
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
}

test('active verification scripts contain no global protocol vocabulary', async () => {
  for (const file of activeScripts) {
    const source = await readFile(resolve(root, 'scripts', file), 'utf8')
    for (const forbidden of forbiddenProtocolStrings) {
      assert.equal(source.includes(forbidden), false, file + ' contains forbidden protocol vocabulary')
    }
    for (const port of [['30', '80'], ['30', '82']].map(parts => parts.join(''))) {
      assert.equal(source.includes(port), false, file + ' names a real web port')
    }
  }
})

test('archived docs use relative links and current-state prose', async () => {
  const [enhancement, audit, review] = await Promise.all([
    readFile(archivedEnhancementPath, 'utf8'),
    readFile(archivedAuditPath, 'utf8'),
    readFile(archivedReviewPath, 'utf8'),
  ])
  assert.match(enhancement, /\]\(\.\/published-plugin-coupling-review-2026-08-26\.md\)/)
  assert.match(enhancement, /\]\(\.\.\/issue-3-implementation-evidence\.md\)/)
  assert.match(audit, /\]\(\.\.\/issue-3-implementation-evidence\.md\)/)
  assert.match(review, /\]\(\.\/enhancement-seams\.md\)/)
  assert.doesNotMatch(enhancement, /加固前|加固后|本轮|backlog|\[ \]/)
  assert.doesNotMatch(audit, /加固前|加固后|本轮|backlog|used to|no longer|Release acceptance checklist/)
})

test('strict verification rejects root input before any other work', () => {
  const result = spawnStrict({ MOBILE_PAIRING_ROOT: '/tmp/unused-mobile-root' })
  const combined = (result.stderr || '') + (result.stdout || '')
  assert.notEqual(result.status, 0)
  assert.match(combined, /MOBILE_PAIRING_ROOT is forbidden/)
  assert.doesNotMatch(combined, /MOBILE_PAIRING_TARBALL is required/)
  assert.doesNotMatch(combined, /typecheck/)
})

test('strict verification requires both Pairing inputs', () => {
  const result = spawnStrict({ MOBILE_PAIRING_TARBALL: '/tmp/unused-mobile-pairing.tgz' })
  const combined = (result.stderr || '') + (result.stdout || '')
  assert.notEqual(result.status, 0)
  assert.match(combined, /MOBILE_PAIRING_SHA256 must be an exact lowercase normalized 64-character hexadecimal SHA-256 digest/)
  assert.doesNotMatch(combined, /typecheck/)
})

test('strict verification rejects an unnormalized Pairing hash', () => {
  const result = spawnStrict({
    MOBILE_PAIRING_TARBALL: '/tmp/unused-mobile-pairing.tgz',
    MOBILE_PAIRING_SHA256: 'A'.repeat(64),
  })
  const combined = (result.stderr || '') + (result.stdout || '')
  assert.notEqual(result.status, 0)
  assert.match(combined, /MOBILE_PAIRING_SHA256 must be an exact lowercase normalized 64-character hexadecimal SHA-256 digest/)
  assert.doesNotMatch(combined, /not found/)
})

test('strict verification rejects a tarball whose bytes do not match the expected hash', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-mobile-strict-hash-test-'))
  const archive = join(directory, 'pairing.tgz')
  try {
    await writeFile(archive, 'synthetic Pairing bytes')
    const result = spawnStrict({
      MOBILE_PAIRING_TARBALL: archive,
      MOBILE_PAIRING_SHA256: '0'.repeat(64),
    })
    const combined = (result.stderr || '') + (result.stdout || '')
    assert.notEqual(result.status, 0)
    assert.match(combined, /does not match MOBILE_PAIRING_SHA256/)
    assert.doesNotMatch(combined, /typecheck/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('strict verification requires the fixed official revision', async () => {
  const strict = await readFile(strictPath, 'utf8')
  const workflow = await readFile(sharedPath, 'utf8')
  const official = await readFile(resolve(root, 'scripts/verify-official-dsh-checkout.mjs'), 'utf8')
  const override = ['DSH', 'EXPECTED', 'REVISION'].join('_')
  assert.match(workflow, /REQUIRED_DSH_REVISION/)
  assert.match(workflow, /REQUIRED_DSH_TAG/)
  assert.match(official, /REQUIRED_DSH_REVISION/)
  assert.match(official, /REQUIRED_DSH_TAG/)
  assert.equal(strict.includes(override), false)
  assert.equal(workflow.includes(override), false)
  assert.equal(official.includes(override), false)
})

test('active evidence pins alpha1 strict verification', async () => {
  const evidence = await readFile(evidenceDocPath, 'utf8')
  const currentEvidence = evidence
  assert.match(currentEvidence, /dsh-v0\.1\.2-alpha\.1/)
  assert.match(currentEvidence, /cd5ef8148158c3a752a658978873241fdf8e2bbc/)
  assert.match(currentEvidence, /MOBILE_PAIRING_TARBALL/)
  assert.match(currentEvidence, /MOBILE_PAIRING_SHA256/)
  assert.doesNotMatch(currentEvidence, /dsh-v0\.1\.1-rc\.2|b150a551b8d465e31e418e1b2eaf5e79bbb7d28e|DSH_EXPECTED_REVISION|verify-clean-rc2-matrix/)
  assert.match(evidence, /Pairing's strict pack gate owns runtime dependency closure/)
  assert.match(evidence, /O_NOFOLLOW/)
  assert.match(evidence, /official-baseline/)
  assert.match(evidence, /215 mobile-web tests; 34 matrix tests/)
  assert.match(evidence, /Focused official-checkout and mobile-matrix tests: 42 passed/)

})

test('missing Pairing input fails without discovering a sibling', async () => {
  const result = spawnSync(process.execPath, [devPath], { env: sanitizedChildEnv(cleanEnv()), encoding: 'utf8' })
  const combined = (result.stderr || '') + (result.stdout || '')
  assert.notEqual(result.status, 0)
  assert.match(combined, /set exactly one of MOBILE_PAIRING_TARBALL or MOBILE_PAIRING_ROOT/)
  const resolver = await readFile(resolverPath, 'utf8')
  assert.doesNotMatch(resolver, /resolve\([^\n]+\.\\.\\/)
})

test('development selection is explicitly non-release', async () => {
  const dev = await readFile(devPath, 'utf8')
  const workflow = await readFile(sharedPath, 'utf8')
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8'))
  assert.match(dev, /mode: 'development'/)
  assert.match(workflow, /development-only/)
  assert.match(workflow, /releaseEvidence: isStrict\(mode\) \? undefined : false/)
  assert.match(workflow, /pack\(selectionRoot\(selection\), packDirectory\)/)
  assert.doesNotMatch(packageJson.scripts['verify:release'], /dev/)
})

test('matrix roots and npm/DSH children use isolated operational state', async () => {
  const strict = await readFile(strictPath, 'utf8')
  const dev = await readFile(devPath, 'utf8')
  const workflow = await readFile(sharedPath, 'utf8')
  const matrix = await readFile(resolve(root, 'scripts/mobile-matrix.mjs'), 'utf8')
  const resolver = await readFile(resolverPath, 'utf8')
  const official = await readFile(resolve(root, 'scripts/verify-official-dsh-checkout.mjs'), 'utf8')
  assert.match(workflow, /mkdtempSync\(join\(tmpdir\(\)/)
  assert.match(workflow, /lstatSync\(tempRoot\)/)
  assert.match(workflow, /removeTemporaryRoot\(tempRoot\)/)
  assert.match(workflow, /unlinkSync\(tempRoot\)/)
  assert.match(workflow, /prepareOfficialDshCheckout\(provenanceCheckout, tempRoot\)/)
  assert.match(workflow, /DSH_UPSTREAM: checkoutResult\.sourceCheckout/)
  assert.match(strict, /runCleanAlpha1MobileMatrix/)
  assert.match(dev, /runCleanAlpha1MobileMatrix/)
  assert.doesNotMatch(strict, /mkdtempSync/)
  assert.doesNotMatch(dev, /mkdtempSync/)
  assert.match(matrix, /env: sanitizedChildEnv\(env\)/)
  assert.match(matrix, /spawnChild\(/)
  assert.match(resolver, /env: sanitizedChildEnv\(\)/)
  assert.match(resolver, /unlinkSync\(tempDir\)/)
  assert.match(official, /env: sanitizedChildEnv\(\)/)
  assert.match(official, /cpSync\(source, destination/)
  assert.match(official, /unlinkSync\(root\)/)
  assert.match(official, /dereference: false/)
  assert.match(official, /const stat = lstatSync\(sourcePath\)/)
  assert.match(official, /return stat\.isDirectory\(\) \|\| stat\.isFile\(\)/)
  assert.match(official, /child\.split\(sep\)\.includes\('node_modules'\)/)
  assert.doesNotMatch(official, /verbatimSymlinks/)
  assert.match(official, /run\('pnpm', \[\'install\', \'--offline\', \'--frozen-lockfile\'/)
  assert.match(official, /run\('pnpm', \['run', 'clean'/)
  assert.match(official, /run\('pnpm', \['run', 'build'/)
  assert.match(official, /sha256File\(cli\)/)
  assert.doesNotMatch(official, /DSH_OFFICIAL_CLI_ARTIFACT|dsh-alpha1-clean/)
  assert.doesNotMatch(workflow, /env: \{ \.\.\.process\.env/)

  const names = [
    'DSH_HOME',
    'DSH_UPSTREAM',
    'PATH',
    'CI',
    'DEEPSEEK_API_KEY',
    'AWS_SECRET_ACCESS_KEY',
    'NPM_TOKEN',
    'NPM_CONFIG_USERCONFIG',
    'NPM_USERCONFIG',
    'SSH_AUTH_SOCK',
    'GIT_CONFIG_GLOBAL',
    'AZURE_CLIENT_ID',
    'GOOGLE_APPLICATION_CREDENTIALS',
    'NODE_PATH',
    'NODE_OPTIONS',
  ]
  const capture = [
    'const names = process.argv.slice(1)',
    'process.stdout.write(JSON.stringify(Object.fromEntries(names.map(name => [name, process.env[name] ?? null]))))',
  ].join(';')
  const childEnv = {
    DSH_HOME: '/tmp/mobile-child-home',
    DSH_UPSTREAM: '/tmp/mobile-child-upstream',
    CI: 'true',
    DEEPSEEK_API_KEY: 'secret-deepseek',
    AWS_SECRET_ACCESS_KEY: 'secret-aws',
    NPM_TOKEN: 'secret-npm',
    NPM_CONFIG_USERCONFIG: '/tmp/secret-npmrc',
    NPM_USERCONFIG: '/tmp/secret-npmrc-alias',
    SSH_AUTH_SOCK: '/tmp/agent.sock',
    GIT_CONFIG_GLOBAL: '/tmp/secret-gitconfig',
    AZURE_CLIENT_ID: 'secret-azure-client',
    GOOGLE_APPLICATION_CREDENTIALS: '/tmp/google.json',
    NODE_PATH: '/tmp/node-path',
    NODE_OPTIONS: '--require /tmp/secret-hook.cjs',
  }
  const assertCaptured = output => {
    const observed = JSON.parse(output)
    assert.equal(observed.DSH_HOME, '/tmp/mobile-child-home')
    assert.equal(observed.DSH_UPSTREAM, '/tmp/mobile-child-upstream')
    assert.equal(observed.CI, 'true')
    for (const name of names.slice(4)) assert.equal(observed[name], null, name)
  }
  const npmOutput = run('npm', ['exec', '--offline', '--', process.execPath, '-e', capture, ...names], { env: childEnv })
  const npmLines = npmOutput.trim().split('\n')
  assertCaptured(npmLines[npmLines.length - 1])

  const child = spawnChild(process.execPath, ['-e', capture, ...names], { env: childEnv })
  const spawnedOutput = await new Promise((resolveOutput, reject) => {
    let text = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => { text += chunk })
    child.once('error', reject)
    child.once('exit', code => {
      if (code === 0) resolveOutput(text)
      else reject(new Error('capture child exited with code ' + String(code)))
    })
  })
  assertCaptured(spawnedOutput)
})

function normalizeWrapper(source) {
  return source
    .replace(/resolvePairingManifest(?:Strict|Dev)/g, 'resolvePairingManifest')
    .replace(/mode: '(?:strict|development)'/g, "mode: 'selected'")
}

test('strict and development wrappers share each orchestration runner', async () => {
  const pairs = [
    [strictPath, devPath, 'runCleanAlpha1MobileMatrix'],
    [strictPairingPath, devPairingPath, 'runPairingArtifactVerification'],
    [strictTwoTierPath, devTwoTierPath, 'runTwoTierCompatibility'],
  ]
  const workflow = await readFile(sharedPath, 'utf8')
  for (const [strictFile, developmentFile, runner] of pairs) {
    const strict = await readFile(strictFile, 'utf8')
    const development = await readFile(developmentFile, 'utf8')
    assert.equal(normalizeWrapper(strict), normalizeWrapper(development), runner + ' wrappers differ beyond resolver/mode')
    assert.equal(strict.includes(runner), true)
    assert.equal(development.includes(runner), true)
    assert.equal(strict.includes("from './verification-workflows.mjs'"), true)
    assert.equal(development.includes("from './verification-workflows.mjs'"), true)
    assert.equal(workflow.includes('function ' + runner), true)
  }
})

test('every strict wrapper rejects an explicit Pairing source root', () => {
  for (const file of [strictPath, strictPairingPath, strictTwoTierPath]) {
    const result = spawnSync(process.execPath, [file], {
      env: sanitizedChildEnv({ ...cleanEnv(), MOBILE_PAIRING_ROOT: '/tmp/unused-mobile-root' }),
      encoding: 'utf8',
    })
    const combined = (result.stderr || '') + (result.stdout || '')
    assert.notEqual(result.status, 0, file)
    assert.match(combined, /MOBILE_PAIRING_ROOT is forbidden|cannot select MOBILE_PAIRING_ROOT/, file)
  }
})

test('artifact inspection rejects a missing export target', () => {
  const manifest = {
    name: '@dsh-mobile/example',
    main: 'lib/index.js',
    types: 'lib/index.d.ts',
    exports: {
      '.': {
        types: './lib/index.d.ts',
        default: './lib/index.js',
      },
    },
  }
  const entries = new Set(['package/package.json', 'package/lib/index.js'])
  assert.throws(
    () => assertPublishableManifest(manifest, 'fake artifact', entries),
    /target is missing from tarball/,
  )
})

test('artifact metadata rejects local aliases and absolute staging targets', () => {
  const base = {
    name: '@dsh-mobile/example',
    main: 'lib/index.js',
    exports: { '.': './lib/index.js' },
  }
  assert.throws(
    () => assertPublishableManifest({ ...base, dependencies: { local: 'file:../source' } }, 'fake alias'),
    /source-checkout dependency alias/,
  )
  assert.throws(
    () => assertPublishableManifest({ ...base, main: '/home/example/Workstation/source/lib/index.js' }, 'fake path'),
    /absolute (?:Workstation[/]staging path|package target)/,
  )
  assert.throws(
    () => assertPublishableManifest({ ...base, main: '/Users/example/.local/opt/dsh-staging/source/lib/index.js' }, 'fake macOS path'),
    /absolute (?:Workstation[/]staging path|package target)/,
  )
})

test('artifact metadata validates string and object bin targets', () => {
  const base = {
    name: '@dsh-mobile/example',
    main: 'lib/index.js',
    exports: { '.': './lib/index.js' },
  }
  const entries = new Set(['package/lib/index.js', 'package/bin/one.js'])
  assert.throws(
    () => assertPublishableManifest({ ...base, bin: 'bin/missing.js' }, 'string bin', entries),
    /bin target is missing from tarball/,
  )
  assert.throws(
    () => assertPublishableManifest({ ...base, bin: { one: 'bin/one.js', two: 'bin/missing.js' } }, 'object bin', entries),
    /bin\.two target is missing from tarball/,
  )
  assert.throws(
    () => assertPublishableManifest({ ...base, bin: { one: '/Users/example/Workstation/bin.js' } }, 'absolute bin', entries),
    /absolute (?:Workstation[/]staging path|package target)/,
  )
})

test('packed Pairing metadata rejects wrong name, version, and tunnel dependency', async () => {
  const base = {
    name: '@dsh-mobile/pairing',
    version: '0.1.12',
    main: 'lib/index.js',
    exports: { '.': './lib/index.js' },
    dependencies: {
      '@dsh-mobile/e2e-tunnel': 'github:NOirBRight/dsh-e2e-tunnel#v0.1.4',
    },
  }
  const cases = [
    ['name', { ...base, name: '@dsh-mobile/not-pairing' }, /must have name @dsh-mobile\/pairing/],
    ['version', { ...base, version: '0.1.10' }, /must have exact version 0.1.12/],
    ['dependency', { ...base, dependencies: { '@dsh-mobile/e2e-tunnel': 'github:NOirBRight/dsh-e2e-tunnel#v0.1.3' } }, /must depend on @dsh-mobile\/e2e-tunnel exactly github:NOirBRight\/dsh-e2e-tunnel#v0.1.4/],
    ['dependency section', { ...base, dependencies: {}, peerDependencies: { '@dsh-mobile/e2e-tunnel': 'github:NOirBRight/dsh-e2e-tunnel#v0.1.4' } }, /must depend on @dsh-mobile\/e2e-tunnel exactly/],
  ]
  for (const [label, manifest, expected] of cases) {
    const { archive, directory } = await createSyntheticPairingArchive(manifest)
    try {
      assert.throws(() => inspectPairingArtifact(archive), expected, label)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
})

test('artifact inspection rejects duplicate and credential-bearing tar entries', async () => {
  const manifest = {
    name: '@dsh-mobile/example',
    main: 'lib/index.js',
    exports: { '.': './lib/index.js' },
  }
  const credentialPaths = [
    '.env',
    '.env.production',
    '.envrc',
    'config/credentials.json',
    'config/.credentials.json',
    'config/credentials-prod.json',
    '.npmrc',
    '.pypirc',
    'ssh/id_rsa',
    'certs/client.pem',
    'certs/client.p12',
    'certs/client.key',
  ]
  for (const path of credentialPaths) {
    const { archive, directory } = await createSyntheticPairingArchive(manifest, [path])
    try {
      assert.throws(() => inspectPackedArtifact(archive), /credential-bearing path/, path)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }

  const directory = await mkdtemp(join(tmpdir(), 'dsh-mobile-duplicate-test-'))
  const packageDirectory = join(directory, 'package')
  const archive = join(directory, 'duplicate.tgz')
  try {
    await mkdir(join(packageDirectory, 'lib'), { recursive: true })
    await writeFile(join(packageDirectory, 'package.json'), JSON.stringify({
      name: '@dsh-mobile/example',
      main: 'lib/index.js',
      exports: { '.': './lib/index.js' },
    }))
    await writeFile(join(packageDirectory, 'lib/index.js'), 'export {}\n')
    const packed = spawnSync('tar', [
      '-czf', archive,
      '-C', directory,
      'package/package.json',
      'package/lib/index.js',
      'package/lib/index.js',
    ], { encoding: 'utf8', env: sanitizedChildEnv() })
    assert.equal(packed.status, 0, packed.stderr)
    assert.throws(() => inspectPackedArtifact(archive), /duplicate tar entry/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('boot URL waiter removes startup listeners after every settle path', async () => {
  const createChild = () => {
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    return child
  }
  const state = () => ({ text: '', overflowed: false })

  const resolvedChild = createChild()
  const resolvedStdout = state()
  const resolvedStderr = state()
  const resolved = waitForProfileUrl(resolvedChild, resolvedStdout, resolvedStderr, 'resolved profile')
  assert.equal(resolvedChild.stdout.listenerCount('data'), 1)
  assert.equal(resolvedChild.stderr.listenerCount('data'), 1)
  resolvedStdout.text = 'dsh web: http://127.0.0.1:1234/?token=test-token'
  resolvedChild.stdout.emit('data', '')
  assert.equal(await resolved, 'http://127.0.0.1:1234/?token=test-token')
  assert.equal(resolvedChild.stdout.listenerCount('data'), 0)
  assert.equal(resolvedChild.stderr.listenerCount('data'), 0)
  assert.equal(resolvedChild.listenerCount('error'), 0)
  assert.equal(resolvedChild.listenerCount('exit'), 0)

  const exitedChild = createChild()
  const exited = waitForProfileUrl(exitedChild, state(), state(), 'exited profile')
  exitedChild.emit('exit', 1, 'SIGTERM')
  await assert.rejects(exited, error => error instanceof Error && /timeout=false signal=SIGTERM exitCode=1/.test(error.message))
  assert.equal(exitedChild.stdout.listenerCount('data'), 0)
  assert.equal(exitedChild.stderr.listenerCount('data'), 0)
  assert.equal(exitedChild.listenerCount('error'), 0)
  assert.equal(exitedChild.listenerCount('exit'), 0)

  const timedOutChild = createChild()
  timedOutChild.exitCode = 0
  timedOutChild.signalCode = null
  const timedOut = waitForProfileUrl(timedOutChild, state(), state(), 'timed out profile', 5)
  await assert.rejects(timedOut, error => error instanceof Error && /boot timed out \(timeout=true signal=null exitCode=0\)/.test(error.message))
  assert.equal(timedOutChild.stdout.listenerCount('data'), 0)
  assert.equal(timedOutChild.stderr.listenerCount('data'), 0)
  assert.equal(timedOutChild.listenerCount('error'), 0)
  assert.equal(timedOutChild.listenerCount('exit'), 0)
})

test('boot manifest retains official core entries and rejects extra non-core entries', () => {
  const expectedEntries = [
    '@dsh-mobile/pairing',
    '@dsh-mobile/interaction-operations',
    '@dsh-mobile/ui-layout-mobile',
  ]
  const baseEntries = [
    { id: '@deepseek-ai/dsh-client-modules', url: '/plugins/core.js' },
    { id: '@deepseek-ai/dsh-client-ui-renderer', url: '/plugins/renderer.js' },
    { id: expectedEntries[0], url: '/plugins/pairing.js' },
    { id: expectedEntries[1], url: '/plugins/interaction.js' },
    { id: expectedEntries[2], url: '/plugins/layout.js' },
  ]
  const html = entries => JSON.stringify({ entries })
  assert.deepEqual(assertBootEntries(html(baseEntries), expectedEntries, expectedEntries[2], 'mobile'), {
    [expectedEntries[0]]: '/plugins/pairing.js',
    [expectedEntries[1]]: '/plugins/interaction.js',
    [expectedEntries[2]]: '/plugins/layout.js',
  })
  for (const extra of ['@dsh-mobile/extra', 'dsh-composer-picker', 'dsh-external-agents', 'dsh-provider-ui']) {
    assert.throws(
      () => assertBootEntries(html([...baseEntries, { id: extra, url: '/plugins/extra.js' }]), expectedEntries, expectedEntries[2], 'mobile'),
      error => error instanceof Error && error.message.includes('unexpected non-core boot entry ' + extra),
    )
  }
})

test('manifest bundle URL rejects cross-origin, credentialed, and non-HTTP(S) URLs before fetch', async () => {
  const originalFetch = globalThis.fetch
  let fetchCalls = 0
  globalThis.fetch = async () => {
    fetchCalls += 1
    throw new Error('unexpected network request')
  }
  try {
    const hostUrl = 'http://127.0.0.1:1234/?token=authenticated'
    for (const [bundleUrl, message] of [
      ['https://evil.example/bundle.js', 'different origin'],
      ['http://user:password@127.0.0.1:1234/bundle.js', 'credentials'],
      ['javascript:alert(1)', 'HTTP(S)'],
    ]) {
      await assert.rejects(
        fetchText(bundleUrl, 'mobile manifest bundle', 'dsh_session=secret', hostUrl),
        error => error instanceof Error && error.message.includes(message),
      )
    }
    assert.equal(fetchCalls, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('artifact inspection rejects a changed Pairing hash', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-mobile-hash-test-'))
  const file = join(directory, 'pairing.tgz')
  try {
    await writeFile(file, 'original')
    const hash = sha256File(file)
    await appendFile(file, 'changed')
    assert.throws(() => assertUnchanged(file, hash, 'MOBILE_PAIRING_TARBALL'), /changed during verification/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('empty strict tarball input fails before build', () => {
  const result = spawnStrict({ MOBILE_PAIRING_TARBALL: '', MOBILE_PAIRING_SHA256: '0'.repeat(64) })
  const combined = (result.stderr || '') + (result.stdout || '')
  assert.notEqual(result.status, 0)
  assert.match(combined, /MOBILE_PAIRING_TARBALL is required/)
  assert.doesNotMatch(combined, /typecheck/)
})

test('release workflow tracks the e2e-tunnel artifact consumed by Pairing', async () => {
  const workflow = await readFile(workflowDocPath, 'utf8')
  assert.match(workflow, /v0\.1\.4/)
  assert.doesNotMatch(workflow, /v0\.1\.3/)
})

test('AM01S mux service executes the published binary through PATH', async () => {
  const service = await readFile(muxServicePath, 'utf8')
  assert.match(service, /Environment=PATH=/)
  assert.match(service, /ExecStart=\/usr\/bin\/env dsh-pair-mux/)
  assert.doesNotMatch(service, /plugins\/pairing|mux-cli/)
  const deployment = await readFile(resolve(root, 'docs/vps-endpoint-deployment.md'), 'utf8')
  assert.match(deployment, /43168/)
  assert.doesNotMatch(deployment, /43170/)
})

test('old release naming is absent from package scripts and active files', async () => {
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8'))
  const oldName = ['r', 'c', '2'].join('')
  assert.equal(JSON.stringify(packageJson.scripts).toLowerCase().includes(oldName), false)
  for (const file of activeScripts) {
    const source = await readFile(resolve(root, 'scripts', file), 'utf8')
    assert.equal(source.toLowerCase().includes(oldName), false, file)
  }
})

test('strict Pairing policy rejects metadata, target, credential, bin, and patch drift', () => {
  const base = strictPairingManifest()
  const entries = new Set([
    'package/package.json',
    'package/lib/index.js',
    'package/lib/index.d.ts',
    'package/lib/client.js',
    'package/lib/mux-cli.js',
    'package/cordis.patch.yml',
  ])
  const cases = [
    ['main target', { main: 'lib/other.js' }, /main must be exactly lib\/index\.js/],
    ['types target', { types: 'lib/other.d.ts' }, /types must be exactly lib\/index\.d\.ts/],
    ['exports drift', { exports: { ...base.exports, './extra': './lib/extra.js' } }, /exports has unexpected keys/],
    ['bin drift', { bin: { 'dsh-pair-mux': './lib/other.js' } }, /bin.dsh-pair-mux must target/],
    ['patch drift', { dsh: { bundle: { patch: './other.patch.yml' } } }, /dsh.bundle.patch exactly/],
    ['forbidden credential dependency', { dependencies: { ...base.dependencies, '@deepseek-ai/dsh-client-runtime': '1.0.0' } }, /forbidden dependency dependencies\.@deepseek-ai\/dsh-client-runtime/],
    ['local mirror dependency', { dependencies: { ...base.dependencies, mirror: 'file:../pairing' } }, /source-checkout dependency alias/],
  ]
  for (const [label, overrides, expected] of cases) {
    assert.throws(() => assertStrictPairingPolicy({ ...base, ...overrides }, entries, 'strict fixture'), expected, label)
  }
  const missing = new Set(entries)
  missing.delete('package/lib/mux-cli.js')
  assert.throws(() => assertStrictPairingPolicy(base, missing, 'strict fixture'), /missing required packed entry package\/lib\/mux-cli\.js/)
  const withCredential = new Set([...entries, 'package/.env'])
  assert.throws(() => assertStrictPairingPolicy(base, withCredential, 'strict fixture'), /unallowed Pairing entry package\/.env/)
})

test('strict resolver copies through O_NOFOLLOW and reports source swaps as evidence', async () => {
  const { archive, directory } = await createSyntheticPairingArchive(strictPairingManifest(), [], true)
  const expectedHash = sha256File(archive)
  let selection
  try {
    selection = withEnvironment({
      MOBILE_PAIRING_TARBALL: archive,
      MOBILE_PAIRING_SHA256: expectedHash,
      MOBILE_PAIRING_ROOT: undefined,
    }, () => resolvePairingManifestStrict())
    assert.notEqual(selection.tarball, archive)
    assert.match(selection.tarball, /dsh-mobile-pairing-input-/)
    assert.deepEqual(JSON.parse(selection.manifest ? JSON.stringify(selection.manifest) : '{}').name, '@dsh-mobile/pairing')
    await appendFile(archive, 'caller mutation')
    assert.throws(() => selection.recheckSource(), /source recheck failed/)
    assert.deepEqual(inspectPairingArtifact(selection.tarball).manifest, strictPairingManifest())
  } finally {
    selection?.cleanup()
    await rm(directory, { recursive: true, force: true })
  }

  const symlinkDirectory = await mkdtemp(join(tmpdir(), 'dsh-mobile-symlink-test-'))
  const symlinkPath = join(symlinkDirectory, 'pairing.tgz')
  try {
    await symlink(archive, symlinkPath)
    assert.throws(() => withEnvironment({
      MOBILE_PAIRING_TARBALL: symlinkPath,
      MOBILE_PAIRING_SHA256: expectedHash,
      MOBILE_PAIRING_ROOT: undefined,
    }, () => resolvePairingManifestStrict()), /non-symlink regular file|ELOOP/)
  } finally {
    await rm(symlinkDirectory, { recursive: true, force: true })
  }
})

test('strict resolver rejects platforms without O_NOFOLLOW', () => {
  assert.throws(() => requireNoFollowFlag({}), /requires O_NOFOLLOW support/)
  assert.throws(() => requireNoFollowFlag({ O_NOFOLLOW: 0 }), /requires O_NOFOLLOW support/)
})

test('core baseline keeps exact order and duplicate official entries', () => {
  const rosterHtml = JSON.stringify({ entries: [
    { id: '@deepseek-ai/dsh-client-ui-renderer', url: '/renderer.js' },
    { id: '@deepseek-ai/dsh-client-ui-renderer', url: '/renderer-duplicate.js' },
  ] })
  const roster = captureOfficialCoreRoster(rosterHtml)
  assert.deepEqual(roster, ['@deepseek-ai/dsh-client-ui-renderer', '@deepseek-ai/dsh-client-ui-renderer'])
  assert.deepEqual(assertBootEntries(rosterHtml, [], undefined, 'mobile', roster), {})
  const changed = JSON.stringify({ entries: [{ id: '@deepseek-ai/dsh-client-ui-renderer', url: '/renderer.js' }] })
  assert.throws(() => assertBootEntries(changed, [], undefined, 'mobile', roster), /official core roster differs from baseline/)
  assert.throws(() => captureOfficialCoreRoster(JSON.stringify({ entries: [
    { id: '@deepseek-ai/dsh-client-ui-renderer', url: '/renderer.js' },
    { id: '@dsh-mobile/pairing', url: '/pairing.js' },
  ] })), /contains non-core boot entry/)
})

test('manual redirects remain same-origin, bounded, and body-cancelled', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options })
    if (calls.length === 1) return new Response('redirect body', { status: 302, headers: { location: '/bundle.js' } })
    return new Response('bundle body', { status: 200 })
  }
  try {
    const text = await fetchText('/', 'redirect test', 'dsh_session=secret', 'http://127.0.0.1:1234/?token=auth')
    assert.equal(text, 'bundle body')
    assert.equal(calls.length, 2)
    assert.equal(calls[0].options.redirect, 'manual')
    assert.equal(calls[1].options.redirect, 'manual')
    assert.equal(calls[0].options.headers.cookie, 'dsh_session=secret')
    assert.equal(calls[1].options.headers.cookie, 'dsh_session=secret')
  } finally {
    globalThis.fetch = originalFetch
  }

  const rejectRedirect = async location => {
    let fetchCalls = 0
    globalThis.fetch = async () => {
      fetchCalls += 1
      return new Response('', { status: 302, headers: location === undefined ? {} : { location } })
    }
    try {
      await assert.rejects(fetchText('/', 'redirect rejection', 'dsh_session=secret', 'http://127.0.0.1:1234/?token=auth'), /redirect/)
      assert.equal(fetchCalls, 1)
    } finally {
      globalThis.fetch = originalFetch
    }
  }
  await rejectRedirect('https://evil.example/bundle.js')
  await rejectRedirect(undefined)
})

test('child error is not treated as exit and shutdown preserves cleanup errors', async () => {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.exitCode = null
  child.signalCode = null
  child.kill = signal => {
    queueMicrotask(() => child.emit('error', new Error('synthetic child error')))
    queueMicrotask(() => {
      child.exitCode = signal === 'SIGKILL' ? 137 : 143
      child.emit('exit', child.exitCode, signal)
    })
    return true
  }
  await assert.rejects(stopChild(child), error => error instanceof Error && error.message.includes('synthetic child error'))
  assert.equal(child.exitCode, 143)
  assert.equal(child.stdout.listenerCount('data'), 0)
  assert.equal(child.stderr.listenerCount('data'), 0)
})

test('aggregateErrors preserves the primary error before every cleanup error', () => {
  const primary = new Error('primary failure')
  const cleanupA = new Error('cleanup A')
  const cleanupB = new Error('cleanup B')
  const failure = aggregateErrors(primary, [cleanupA, cleanupB], 'teardown')
  assert.ok(failure instanceof AggregateError)
  assert.deepEqual(failure.errors, [primary, cleanupA, cleanupB])
})

test('fresh official CLI gate rejects stale, missing, and symlink output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-mobile-cli-gate-test-'))
  const cli = join(directory, 'bin.js')
  try {
    await writeFile(cli, '#!/usr/bin/env node\n')
    assert.doesNotThrow(() => assertFreshOfficialCli(cli))
    await rm(cli)
    assert.throws(() => assertFreshOfficialCli(cli), /was not newly built/)
    await writeFile(cli, '#!/usr/bin/env node\n')
    const link = join(directory, 'link.js')
    await symlink(cli, link)
    assert.throws(() => assertFreshOfficialCli(link), /regular file/)
    const folder = join(directory, 'folder')
    await mkdir(folder)
    assert.throws(() => assertFreshOfficialCli(folder), /regular file/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('official CLI execution requires the prepared digest', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-mobile-cli-digest-test-'))
  const cli = join(directory, 'bin.js')
  try {
    await writeFile(cli, '#!/usr/bin/env node\n')
    const expectedHash = sha256File(cli)
    assert.equal(assertOfficialCliDigest(cli, expectedHash), expectedHash)
    await appendFile(cli, 'changed\n')
    assert.throws(() => assertOfficialCliDigest(cli, expectedHash), /changed before execution/)
    await rm(cli)
    await symlink(join(directory, 'missing.js'), cli)
    assert.throws(() => assertOfficialCliDigest(cli, expectedHash), /regular file|disappeared/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
