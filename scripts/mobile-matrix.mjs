import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import process from 'node:process'

export const commandTimeoutMs = 600_000
export const installTimeoutMs = 120_000
export const bootTimeoutMs = 120_000
export const requestTimeoutMs = 10_000
export const shutdownTimeoutMs = 5_000
export const commandMaxBufferBytes = 16 * 1024 * 1024
export const childOutputLimitBytes = 1024 * 1024
export const responseMaxBytes = 16 * 1024 * 1024

/** Mobile-only contracts that must never be present in a release artifact. */
export const MOBILE_FORBIDDEN_CONTRACTS = ['session-hydration', 'dsh-client-runtime']
export const PAIRING_PACKAGE_NAME = '@dsh-mobile/pairing'
export const PAIRING_PACKAGE_VERSION = '0.1.14'
export const PAIRING_E2E_TUNNEL_DEPENDENCY = 'github:NOirBRight/dsh-e2e-tunnel#v0.1.5'

const sourceDirectoryPattern = /(?:^|\/)(?:src|test|tests|scripts|node_modules|patches)(?:\/|$)/u
const sourceMapPattern = /\.map$/iu
const patchFilePattern = /\.(?:diff|patch)$/iu
const credentialPathPattern = /(?:^|\/)(?:\.env[^/]*|\.aws(?:\/.*)?|\.ssh(?:\/.*)?|\.netrc|\.docker(?:\/.*)?|\.kube(?:\/.*)?|\.npmrc|\.pypirc|\.yarnrc(?:\.yml)?|\.pnpmrc|\.git-credentials|\.gitconfig|\.git(?:\/.*)?|\.gnupg(?:\/.*)?|\.config\/(?:gcloud|gh|aws)(?:\/.*)?|\.?credentials[^/]*|service-account[^/]*\.json|id_[^/]*|[^/]+\.(?:key|pem|p8|p12|pfx|jks|keystore|truststore|pkcs8|pkcs12|p7b|p7c|crt|csr|cer|der|asc|kdbx|gpg))$/iu
const vendoredOfficialPathPattern = /(?:^|\/)@deepseek-ai(?:\/|$)/u
const absoluteWorkstationPathPattern = /(?:^|[/\\])(?:home|Users)[/\\][^/\\]+[/\\](?:Workstation|staging|dsh-staging|\.local[/\\]opt[/\\]dsh-staging)(?:[/\\]|$)/iu
const absoluteWindowsPathPattern = /[A-Z]:[/\\][^\n]*?(?:Workstation|staging|dsh-staging)[/\\]/iu
const dependencyAliasPattern = /^(?:file|link|workspace):/iu
const localDependencyPathPattern = /^(?:\.{1,2}[/\\]|[/\\]|[A-Z]:)/iu
const sourceAliasPattern = /["'](?:file|link|workspace):/iu
const secretChildEnvNamePattern = /(?:KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)/iu
const authAgentOrConfigChildEnvNamePattern = /^(?:SSH_AUTH_SOCK|SSH_AGENT_PID|SSH_CONFIG|GIT_ASKPASS|GIT_SSH_COMMAND|GIT_CONFIG_|NPM_TOKEN|NPM_USERCONFIG|NPM_CONFIG_USERCONFIG|NPM_CONFIG_GLOBALCONFIG|NPM_CONFIG_.*(?:AUTH|TOKEN)|PIP_CONFIG_FILE|PIP_INDEX_URL|PIP_EXTRA_INDEX_URL|UV_INDEX_URL|POETRY_HTTP_BASIC_|TWINE_|PYPIRC_PATH|DOCKER_CONFIG|KUBECONFIG|AWS_|AZURE_|GOOGLE_|GCP_|GCLOUD_|CLOUDSDK_|CLOUDFLARE_|CF_|OPENAI_|DEEPSEEK_|ANTHROPIC_|XAI_|GROK_|MISTRAL_|COHERE_|TOGETHER_|PERPLEXITY_)/iu
const nodeInjectionChildEnvNamePattern = /^(?:NODE_PATH|NODE_OPTIONS)$/iu

function isSensitiveChildEnvName(name) {
  return secretChildEnvNamePattern.test(name)
    || authAgentOrConfigChildEnvNamePattern.test(name)
    || nodeInjectionChildEnvNamePattern.test(name)
}

/**
 * Build the environment allowed for release subprocesses.
 * @param overrides Explicit operational values for the child process.
 * @returns A copy of process environment without credential or injection variables.
 */
export function sanitizedChildEnv(overrides = {}) {
  const candidate = { ...process.env, ...(overrides ?? {}) }
  return Object.fromEntries(Object.entries(candidate)
    .filter(([name, value]) => value !== undefined && !isSensitiveChildEnvName(name))
    .map(([name, value]) => [name, String(value)]))
}

/** Run one bounded subprocess and return UTF-8 output. */
export function run(file, args, options = {}) {
  const { env, ...commandOptions } = options
  return execFileSync(file, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: commandTimeoutMs,
    maxBuffer: commandMaxBufferBytes,
    ...commandOptions,
    env: sanitizedChildEnv(env),
  })
}

/**
 * Spawn a release subprocess with a sanitized environment.
 * @param file Executable path.
 * @param args Executable arguments.
 * @param options Spawn options and explicit child environment values.
 * @returns The spawned child process.
 */
export function spawnChild(file, args, options = {}) {
  const { env, detached, ...childOptions } = options
  const processGroup = detached ?? process.platform !== 'win32'
  const child = spawn(file, args, {
    ...childOptions,
    detached: processGroup,
    env: sanitizedChildEnv(env),
  })
  child.__dshProcessGroup = processGroup || process.platform === 'win32'
  return child
}

function dependencySections(manifest) {
  return ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies']
    .flatMap(section => {
      const values = manifest[section]
      if (values === undefined) return []
      if (typeof values !== 'object' || values === null || Array.isArray(values)) {
        throw new Error('manifest ' + section + ' must be an object')
      }
      return Object.entries(values).map(([name, value]) => ({ section, name, value }))
    })
}

function assertRelativeTarget(target, label) {
  if (typeof target !== 'string' || target.length === 0 || target.trim() === '') {
    throw new Error(label + ' has an empty package target')
  }
  if (target.includes('\\')) throw new Error(label + ' contains a backslash in its package target: ' + target)
  if (target.includes('?') || target.includes('#')) {
    throw new Error(label + ' contains a query or hash in its package target: ' + target)
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(target)) {
    throw new Error(label + ' contains a URL or drive-relative package target: ' + target)
  }
  if (absoluteWorkstationPathPattern.test(target) || absoluteWindowsPathPattern.test(target)) {
    throw new Error(label + ' contains an absolute Workstation/staging path')
  }
  if (target.startsWith('/') || target.startsWith('//') || /^[A-Z]:[/\\]/iu.test(target)) {
    throw new Error(label + ' contains an absolute package target: ' + target)
  }
  const normalized = target.replace(/^\.\//u, '')
  if (normalized === '.' || normalized === '') throw new Error(label + ' contains a dot or empty package target: ' + target)
  const parts = normalized.split('/')
  if (parts.some(part => part === '' || part === '.' || part === '..')) {
    throw new Error(label + ' contains a dot, empty, or parent package target: ' + target)
  }
  return 'package/' + normalized
}

function exportTargets(value, label, targets = []) {
  if (typeof value === 'string') {
    targets.push({ target: value, label })
    return targets
  }
  if (value === null || value === undefined) return targets
  if (Array.isArray(value)) {
    value.forEach((item, index) => exportTargets(item, label + '[' + index + ']', targets))
    return targets
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      exportTargets(child, label + '.' + key, targets)
    }
    return targets
  }
  throw new Error(label + ' has an invalid exports target')
}

function assertPackedTarget(target, label, entries) {
  const path = assertRelativeTarget(target, label)
  if (path.includes('*')) {
    const [prefix, suffix] = path.split('*')
    if (![...entries].some(entry => entry.startsWith(prefix) && entry.endsWith(suffix))) {
      throw new Error(label + ' target is missing from tarball: ' + target)
    }
    return
  }
  if (!entries.has(path)) throw new Error(label + ' target is missing from tarball: ' + target)
}

function binTargets(value, label) {
  if (typeof value === 'string') return [{ target: value, label }]
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(label + ' has an invalid bin target')
  }
  return Object.entries(value).map(([name, target]) => {
    if (typeof target !== 'string') throw new Error(label + '.' + name + ' has an invalid bin target')
    return { target, label: label + '.' + name }
  })
}

function assertBinTarget(target, label, entries) {
  const path = assertRelativeTarget(target, label)
  if (path.includes('*')) throw new Error(label + ' cannot contain a wildcard target')
  if (entries !== undefined && !entries.has(path)) {
    throw new Error(label + ' target is missing from tarball: ' + target)
  }
}

/** Validate package metadata without depending on a local checkout. */
export function assertPublishableManifest(manifest, label, entries = undefined) {
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    throw new Error(label + ' must contain an object manifest')
  }
  const dependencies = dependencySections(manifest)
  for (const { section, name, value } of dependencies) {
    if (name === 'deepseek-harness' || name === '@deepseek-ai/deepseek-harness') {
      throw new Error(label + ' depends on a DSH checkout package')
    }
    if (typeof value !== 'string') throw new Error(label + ' dependency ' + section + '.' + name + ' must be a string')
    if (dependencyAliasPattern.test(value) || localDependencyPathPattern.test(value) || absoluteWorkstationPathPattern.test(value) || absoluteWindowsPathPattern.test(value)) {
      throw new Error(label + ' has a source-checkout dependency alias: ' + section + '.' + name + ' -> ' + value)
    }
  }
  if (entries === undefined) {
    if (manifest.exports !== undefined) {
      const targets = exportTargets(manifest.exports, label + '.exports')
      if (targets.length === 0) throw new Error(label + ' has no exports targets')
      for (const { target, label: targetLabel } of targets) assertRelativeTarget(target, targetLabel)
    }
    if (manifest.main !== undefined) assertRelativeTarget(manifest.main, label + '.main')
    if (manifest.types !== undefined) assertRelativeTarget(manifest.types, label + '.types')
    if (manifest.bin !== undefined) {
      for (const { target, label: targetLabel } of binTargets(manifest.bin, label + '.bin')) {
        assertBinTarget(target, targetLabel)
      }
    }
    const patch = manifest.dsh?.bundle?.patch
    if (patch !== undefined) assertRelativeTarget(patch, label + '.dsh.bundle.patch')
    return
  }
  if (manifest.exports !== undefined) {
    const targets = exportTargets(manifest.exports, label + '.exports')
    if (targets.length === 0) throw new Error(label + ' has no exports targets')
    for (const { target, label: targetLabel } of targets) assertPackedTarget(target, targetLabel, entries)
  }
  if (manifest.main !== undefined) assertPackedTarget(manifest.main, label + '.main', entries)
  if (manifest.types !== undefined) assertPackedTarget(manifest.types, label + '.types', entries)
  if (manifest.bin !== undefined) {
    for (const { target, label: targetLabel } of binTargets(manifest.bin, label + '.bin')) {
      assertBinTarget(target, targetLabel, entries)
    }
  }
  const patch = manifest.dsh?.bundle?.patch
  if (patch !== undefined) assertPackedTarget(patch, label + '.dsh.bundle.patch', entries)
}

/** Validate the exact published Pairing package metadata consumed by mobile release checks. */
export function assertPairingManifest(manifest, label) {
  assertPublishableManifest(manifest, label)
  if (manifest.name !== PAIRING_PACKAGE_NAME) {
    throw new Error(label + ' must have name ' + PAIRING_PACKAGE_NAME)
  }
  if (manifest.version !== PAIRING_PACKAGE_VERSION) {
    throw new Error(label + ' must have exact version ' + PAIRING_PACKAGE_VERSION)
  }
  const dependency = manifest.dependencies?.['@dsh-mobile/e2e-tunnel']
  if (dependency !== PAIRING_E2E_TUNNEL_DEPENDENCY) {
    throw new Error(label + ' must depend on @dsh-mobile/e2e-tunnel exactly ' + PAIRING_E2E_TUNNEL_DEPENDENCY)
  }
  for (const section of ['optionalDependencies', 'peerDependencies']) {
    if (manifest[section]?.['@dsh-mobile/e2e-tunnel'] !== undefined) {
      throw new Error(label + ' must declare @dsh-mobile/e2e-tunnel in dependencies only')
    }
  }
}

const strictPairingExports = Object.freeze({
  '.': Object.freeze({ types: './lib/index.d.ts', default: './lib/index.js' }),
  './client': './lib/client.js',
  './package.json': './package.json',
})
const strictPairingForbiddenDependencies = new Set([
  PAIRING_PACKAGE_NAME,
  '@dsh-mobile/session-hydration',
  '@deepseek-ai/dsh-client-runtime',
])

function sameValue(actual, expected) {
  if (actual === expected) return true
  if (typeof actual !== 'object' || actual === null || typeof expected !== 'object' || expected === null) return false
  if (Array.isArray(actual) !== Array.isArray(expected)) return false
  const actualKeys = Object.keys(actual)
  const expectedKeys = Object.keys(expected)
  return actualKeys.length === expectedKeys.length
    && expectedKeys.every(key => Object.hasOwn(actual, key) && sameValue(actual[key], expected[key]))
}

function assertExactObjectKeys(value, expected, label) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(label + ' must be an object')
  }
  const actualKeys = Object.keys(value)
  const expectedKeys = Object.keys(expected)
  if (actualKeys.length !== expectedKeys.length || expectedKeys.some(key => !Object.hasOwn(value, key))) {
    throw new Error(label + ' has unexpected keys; expected exactly ' + expectedKeys.join(', '))
  }
  for (const key of expectedKeys) {
    if (!sameValue(value[key], expected[key])) {
      throw new Error(label + '.' + key + ' must target ' + JSON.stringify(expected[key]))
    }
  }
}

function allowedStrictPairingEntry(entry) {
  const path = entry.slice('package/'.length)
  return path === ''
    || path === 'package.json'
    || path === 'lib'
    || path === 'cordis.patch.yml'
    || path.startsWith('lib/')
    || /^README(?:\.[^/]*)?$/iu.test(path)
    || /^LICENSE(?:\.[^/]*)?$/iu.test(path)
    || /^CHANGELOG(?:\.[^/]*)?$/iu.test(path)
}

/**
 * Enforce the complete published Pairing policy shared by every strict workflow.
 * @param manifest Packed Pairing package manifest.
 * @param entries Packed tar entry paths.
 * @param label Diagnostic label.
 * @returns The validated manifest and normalized packed entries.
 */
export function assertStrictPairingPolicy(manifest, entries, label = 'strict Pairing artifact') {
  assertPairingManifest(manifest, label)
  if (manifest.main !== 'lib/index.js') throw new Error(label + ' main must be exactly lib/index.js')
  if (manifest.types !== 'lib/index.d.ts') throw new Error(label + ' types must be exactly lib/index.d.ts')
  assertExactObjectKeys(manifest.exports, strictPairingExports, label + '.exports')
  assertExactObjectKeys(manifest.bin, { 'dsh-pair-mux': './lib/mux-cli.js' }, label + '.bin')
  if (manifest.dsh?.bundle?.patch !== './cordis.patch.yml') {
    throw new Error(label + ' must declare dsh.bundle.patch exactly ./cordis.patch.yml')
  }
  for (const { section, name } of dependencySections(manifest)) {
    if (strictPairingForbiddenDependencies.has(name)) {
      throw new Error(label + ' has a forbidden dependency ' + section + '.' + name)
    }
  }
  if (!(entries instanceof Set) && !Array.isArray(entries)) {
    throw new Error(label + ' requires packed entries for strict verification')
  }
  const packedEntries = entries instanceof Set ? entries : new Set(entries)
  if (packedEntries.size !== (entries instanceof Set ? entries.size : entries.length)) {
    throw new Error(label + ' contains duplicate packed entries')
  }
  for (const entry of packedEntries) {
    if (typeof entry !== 'string' || !entry.startsWith('package/')) {
      throw new Error(label + ' contains an entry outside package/: ' + String(entry))
    }
  }
  for (const required of [
    'package/package.json',
    'package/lib/index.js',
    'package/lib/index.d.ts',
    'package/lib/client.js',
    'package/lib/mux-cli.js',
    'package/cordis.patch.yml',
  ]) {
    if (!packedEntries.has(required)) throw new Error(label + ' is missing required packed entry ' + required)
  }
  for (const entry of packedEntries) {
    if (!allowedStrictPairingEntry(entry)) throw new Error(label + ' contains an unallowed Pairing entry ' + entry)
  }
  return { manifest, entries: packedEntries }
}

function cleanTarEntry(entry) {
  if (!entry.startsWith('package/')) throw new Error('tarball contains an entry outside package/: ' + entry)
  if (entry.includes('\\') || entry.includes('?') || entry.includes('#')) {
    throw new Error('tarball contains an unsafe entry separator or URL marker: ' + entry)
  }
  const path = entry.slice('package/'.length)
  const parts = path.split('/')
  if (parts.slice(0, -1).some(part => part === '' || part === '.' || part === '..') || ['.', '..'].includes(parts.at(-1))) {
    throw new Error('tarball contains an unsafe entry: ' + entry)
  }
  return path
}

function isRuntimeEntry(entry) {
  return /\.(?:[cm]?js|d\.ts|json|ya?ml)$/iu.test(entry) && !entry.endsWith('package/package.json')
}

function readPackedText(packagePath, entry) {
  return run('tar', ['-xOf', packagePath, entry])
}

/** Inspect a packed mobile artifact and all package entry targets. */
export function inspectPackedArtifact(packagePath) {
  const entries = run('tar', ['-tzf', packagePath]).split('\n').map(entry => entry.trim()).filter(Boolean)
  if (entries.length === 0) throw new Error(packagePath + ' is empty')
  const duplicate = entries.find((entry, index) => entries.indexOf(entry) !== index)
  if (duplicate !== undefined) throw new Error(packagePath + ' contains duplicate tar entry ' + duplicate)
  const paths = new Set()
  for (const entry of entries) {
    const path = cleanTarEntry(entry)
    paths.add('package/' + path)
    if (credentialPathPattern.test(path)) {
      throw new Error(packagePath + ' contains credential-bearing path ' + path)
    }
    if (sourceDirectoryPattern.test('/' + path) || vendoredOfficialPathPattern.test('/' + path) || sourceMapPattern.test(path) || patchFilePattern.test(path)) {
      throw new Error(packagePath + ' contains forbidden packed path ' + path)
    }
    if (absoluteWorkstationPathPattern.test(path) || absoluteWindowsPathPattern.test(path)) {
      throw new Error(packagePath + ' contains an absolute Workstation/staging path ' + path)
    }
  }
  if (!paths.has('package/package.json')) throw new Error(packagePath + ' is missing package.json')
  const manifest = JSON.parse(readPackedText(packagePath, 'package/package.json'))
  assertPublishableManifest(manifest, packagePath + ':package.json', paths)
  const regularEntries = entries.filter(entry => !entry.endsWith('/'))
  const packedText = regularEntries.map(entry => readPackedText(packagePath, entry)).join('\n')
  if (absoluteWorkstationPathPattern.test(packedText) || absoluteWindowsPathPattern.test(packedText)) {
    throw new Error(packagePath + ' contains an absolute Workstation/staging path')
  }
  if (sourceAliasPattern.test(packedText)) throw new Error(packagePath + ' contains a source-checkout dependency alias')
  const runtime = regularEntries.filter(isRuntimeEntry).map(entry => readPackedText(packagePath, entry)).join('\n')
  for (const forbidden of MOBILE_FORBIDDEN_CONTRACTS) {
    if (runtime.includes(forbidden)) throw new Error(packagePath + ' contains a forbidden mobile contract ' + forbidden)
  }
  return { manifest, entries }
}

/** Inspect a packed artifact and enforce the published Pairing metadata. */
export function inspectPairingArtifact(packagePath) {
  const artifact = inspectPackedArtifact(packagePath)
  assertPairingManifest(artifact.manifest, packagePath + ':package.json')
  return artifact
}

/** Pack one same-repository package into a caller-owned temporary directory. */
export function pack(root, destination) {
  const sourceManifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
  assertPublishableManifest(sourceManifest, resolve(root, 'package.json'))
  const output = run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', destination], { cwd: root })
  const report = JSON.parse(output.trim())[0]
  if (report?.filename === undefined) throw new Error('npm pack returned no filename for ' + root)
  const packagePath = resolve(destination, basename(report.filename))
  inspectPackedArtifact(packagePath)
  return packagePath
}

/** Return the hexadecimal SHA-256 digest of one artifact. */
export function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

/** Reject a supplied artifact after any mutation since the recorded digest. */
export function assertUnchanged(filePath, expectedHash, label = 'supplied tarball') {
  const actualHash = sha256File(filePath)
  if (actualHash !== expectedHash) {
    throw new Error(label + ' changed during verification (expected SHA-256 ' + expectedHash + ', got ' + actualHash + ')')
  }
  return actualHash
}

/**
 * Require the official CLI to remain a regular file with its prepared digest.
 * @param cli Official CLI path.
 * @param expectedHash Digest recorded immediately after the official build.
 * @returns The verified CLI digest.
 */
export function assertOfficialCliDigest(cli, expectedHash) {
  if (typeof expectedHash !== 'string' || !/^[0-9a-f]{64}$/u.test(expectedHash)) {
    throw new Error('official DSH CLI digest must be a lowercase SHA-256 value')
  }
  let stat
  try {
    stat = lstatSync(cli)
  } catch (error) {
    throw new Error('official DSH CLI disappeared before execution: ' + cli, { cause: error })
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('official DSH CLI must remain a regular file before execution: ' + cli)
  }
  const actualHash = sha256File(cli)
  if (actualHash !== expectedHash) {
    throw new Error('official DSH CLI changed before execution (expected SHA-256 ' + expectedHash + ', got ' + actualHash + ')')
  }
  return actualHash
}

export function occurrences(text, needle) {
  return text.split(needle).length - 1
}

function done(child) {
  return (child.exitCode !== undefined && child.exitCode !== null)
    || (child.signalCode !== undefined && child.signalCode !== null)
}

/**
 * Preserve the primary failure while retaining every cleanup failure.
 * @param primary Primary operation failure.
 * @param additional Cleanup failures.
 * @param label Aggregate diagnostic label.
 * @returns The original failure, or an aggregate when multiple failures exist.
 */
export function aggregateErrors(primary, additional, label = 'cleanup failed') {
  const errors = []
  if (primary !== undefined && primary !== null) errors.push(primary)
  for (const error of additional) if (error !== undefined && error !== null) errors.push(error)
  if (errors.length === 0) return undefined
  if (errors.length === 1) return errors[0]
  const detail = errors.map(error => error instanceof Error ? error.message : String(error)).join('; ')
  return new AggregateError(errors, label + ': ' + detail)
}

function childStatus(child, timedOut, exitCode = child.exitCode, signal = child.signalCode) {
  return 'timeout=' + String(timedOut) + ' signal=' + String(signal ?? null) + ' exitCode=' + String(exitCode ?? null)
}

function waitForExit(child, timeoutMs) {
  if (done(child)) return Promise.resolve({ exited: true, timedOut: false, exitCode: child.exitCode, signal: child.signalCode, errors: [] })
  return new Promise(resolveExit => {
    let timer
    const errors = []
    const finish = (exited, timedOut, exitCode = child.exitCode, signal = child.signalCode) => {
      clearTimeout(timer)
      child.off('exit', onExit)
      child.off('error', onError)
      resolveExit({ exited, timedOut, exitCode, signal, errors })
    }
    const onExit = (exitCode, signal) => finish(true, false, exitCode, signal)
    const onError = error => errors.push(error)
    timer = setTimeout(() => finish(false, true), timeoutMs)
    child.once('exit', onExit)
    child.on('error', onError)
  })
}

function releaseChildOutput(child) {
  const errors = []
  for (const stream of [child.stdout, child.stderr]) {
    if (stream === undefined || stream === null) continue
    try {
      stream.removeAllListeners()
      stream.destroy?.()
    } catch (error) {
      errors.push(error)
    }
  }
  return errors
}

function signalChild(child, signal) {
  if (child.pid !== undefined && child.pid !== null && child.__dshProcessGroup) {
    if (process.platform === 'win32') {
      try {
        run('taskkill', ['/PID', String(child.pid), '/T', ...(signal === 'SIGKILL' ? ['/F'] : [])], { timeout: shutdownTimeoutMs })
        return
      } catch (primary) {
        try {
          const result = child.kill(signal)
          if (result === false && !done(child)) throw new Error('child rejected ' + signal)
        } catch (secondary) {
          throw aggregateErrors(primary, [secondary], 'tree signal failed')
        }
        throw primary
      }
    }
    try {
      process.kill(-child.pid, signal)
      return
    } catch (primary) {
      try {
        const result = child.kill(signal)
        if (result === false && !done(child)) throw new Error('child rejected ' + signal)
      } catch (secondary) {
        throw aggregateErrors(primary, [secondary], 'tree signal failed')
      }
      if (done(child) && primary?.code === 'ESRCH') return
      throw primary
    }
  }
  const result = child.kill(signal)
  if (result === false && !done(child)) throw new Error('child rejected ' + signal)
}

/** Stop a spawned profile process, including descendants, after real exit. */
export async function stopChild(child) {
  if (child === undefined || child === null) return
  const errors = releaseChildOutput(child)
  if (done(child)) {
    const failure = aggregateErrors(undefined, errors, 'child output cleanup failed')
    if (failure !== undefined) throw failure
    return
  }
  let termResult
  try {
    signalChild(child, 'SIGTERM')
  } catch (error) {
    errors.push(error)
  }
  termResult = await waitForExit(child, shutdownTimeoutMs)
  errors.push(...termResult.errors)
  if (termResult.timedOut) {
    errors.push(new Error('SIGTERM wait timed out (' + childStatus(child, true, termResult.exitCode, termResult.signal) + ')'))
  }
  if (!termResult.exited && !done(child)) {
    try {
      signalChild(child, 'SIGKILL')
    } catch (error) {
      errors.push(error)
    }
    const killResult = await waitForExit(child, shutdownTimeoutMs)
    errors.push(...killResult.errors)
    if (killResult.timedOut) {
      errors.push(new Error('SIGKILL wait timed out (' + childStatus(child, true, killResult.exitCode, killResult.signal) + ')'))
    }
    if (!killResult.exited && !done(child)) {
      errors.push(new Error('DSH profile process did not stop after SIGKILL (' + childStatus(child, killResult.timedOut, killResult.exitCode, killResult.signal) + ')'))
    }
  }
  const failure = aggregateErrors(undefined, errors, 'child shutdown failed')
  if (failure !== undefined) throw failure
}

function appendBounded(state, chunk, label, child) {
  const value = String(chunk)
  const bytes = Buffer.byteLength(value)
  if (state.bytes + bytes > childOutputLimitBytes) {
    state.overflowed = true
    try { signalChild(child, 'SIGTERM') } catch { /* shutdown retries and reports signal failures */ }
    return
  }
  state.bytes += bytes
  state.text += value
  if (state.text.length > childOutputLimitBytes) state.text = state.text.slice(-childOutputLimitBytes)
  state.label = label
}

async function cancelResponseBody(response) {
  if (response?.body === null || response?.body === undefined) return undefined
  try {
    await response.body.cancel()
  } catch (error) {
    return error
  }
  return undefined
}

async function fetchBody(response, label) {
  const declared = Number(response.headers.get('content-length') ?? 0)
  if (Number.isFinite(declared) && declared > responseMaxBytes) {
    const cancelError = await cancelResponseBody(response)
    const failure = aggregateErrors(new Error(label + ' exceeded response limit'), cancelError === undefined ? [] : [cancelError], label + ' body cleanup failed')
    throw failure
  }
  if (response.body === null) return ''
  let reader
  try {
    reader = response.body.getReader()
  } catch (primary) {
    const cancelError = await cancelResponseBody(response)
    const failure = aggregateErrors(primary, cancelError === undefined ? [] : [cancelError], label + ' body cleanup failed')
    throw failure
  }
  const chunks = []
  let length = 0
  let text
  let primary
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      length += next.value.byteLength
      if (length > responseMaxBytes) throw new Error(label + ' exceeded response limit')
      chunks.push(next.value)
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    text = new TextDecoder().decode(bytes)
  } catch (error) {
    primary = error
  }
  const cleanupErrors = []
  if (primary !== undefined) {
    try {
      await reader.cancel()
    } catch (error) {
      cleanupErrors.push(error)
    }
  }
  try {
    reader.releaseLock()
  } catch (error) {
    cleanupErrors.push(error)
  }
  const failure = aggregateErrors(primary, cleanupErrors, label + ' body cleanup failed')
  if (failure !== undefined) throw failure
  return text
}

function parseHttpUrl(value, label) {
  if (typeof value !== 'string' || value === '') throw new Error(label + ' must be an HTTP(S) URL')
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(label + ' is not a valid HTTP(S) URL')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error(label + ' must use HTTP(S)')
  if (parsed.username !== '' || parsed.password !== '') throw new Error(label + ' must not include URL credentials')
  return parsed
}

function resolveSameOriginUrl(value, authenticatedHostUrl, label) {
  if (typeof value !== 'string' || value === '') throw new Error(label + ' must be an HTTP(S) URL')
  const host = parseHttpUrl(authenticatedHostUrl, label)
  let target
  try {
    target = new URL(value, host)
  } catch {
    throw new Error(label + ' is not a valid HTTP(S) URL')
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') throw new Error(label + ' must use HTTP(S)')
  if (target.username !== '' || target.password !== '') throw new Error(label + ' must not include URL credentials')
  if (target.origin !== host.origin) throw new Error(label + ' has a different origin from the authenticated Host')
  return target
}

const redirectStatuses = new Set([301, 302, 303, 307, 308])
const maxRedirects = 5

async function fetchResponse(url, label, cookie, authenticatedHostUrl) {
  let target
  let origin
  if (authenticatedHostUrl === undefined) {
    target = parseHttpUrl(url, label)
    origin = target.origin
    if (cookie !== undefined) throw new Error(label + ' cannot send Cookie without an authenticated Host URL')
  } else {
    target = resolveSameOriginUrl(url, authenticatedHostUrl, label)
    origin = target.origin
  }
  const visited = new Set([target.href])
  let redirects = 0
  for (;;) {
    const response = await fetch(target, {
      headers: cookie === undefined ? {} : { cookie },
      redirect: 'manual',
      signal: AbortSignal.timeout(requestTimeoutMs),
    })
    if (redirectStatuses.has(response.status)) {
      const location = response.headers.get('location')
      const cleanupErrors = []
      const cancelError = await cancelResponseBody(response)
      if (cancelError !== undefined) cleanupErrors.push(cancelError)
      let primary
      if (location === null || location === '') {
        primary = new Error(label + ' redirect is missing Location')
      } else if (redirects >= maxRedirects) {
        primary = new Error(label + ' exceeded redirect limit')
      } else {
        try {
          const next = resolveSameOriginUrl(location, target.href, label + ' redirect')
          if (next.origin !== origin) throw new Error(label + ' redirect has a different origin')
          if (visited.has(next.href)) throw new Error(label + ' redirect loop detected')
          visited.add(next.href)
          target = next
          redirects += 1
        } catch (error) {
          primary = error
        }
      }
      const failure = aggregateErrors(primary, cleanupErrors, label + ' redirect body cleanup failed')
      if (failure !== undefined) throw failure
      continue
    }
    if (!response.ok) {
      const cancelError = await cancelResponseBody(response)
      const failure = aggregateErrors(new Error(label + ' returned HTTP ' + String(response.status)), cancelError === undefined ? [] : [cancelError], label + ' response body cleanup failed')
      throw failure
    }
    return response
  }
}

/** Fetch bounded UTF-8 text, optionally constrained to an authenticated Host origin. */
export async function fetchText(url, label, cookie, authenticatedHostUrl) {
  return fetchBody(await fetchResponse(url, label, cookie, authenticatedHostUrl), label)
}

async function fetchLoginCookie(url, name) {
  const target = parseHttpUrl(url, name + ' token exchange')
  const login = await fetch(target, {
    redirect: 'manual',
    signal: AbortSignal.timeout(requestTimeoutMs),
  })
  let cookie
  let primary
  try {
    if (login.status !== 303) throw new Error(name + ' token exchange returned HTTP ' + String(login.status))
    const setCookie = login.headers.get('set-cookie')
    if (setCookie === null) throw new Error(name + ' token exchange returned no browser-session cookie')
    cookie = setCookie.split(';', 1)[0]
    if (cookie === '') throw new Error(name + ' token exchange returned an empty browser-session cookie')
  } catch (error) {
    primary = error
  }
  const cancelError = await cancelResponseBody(login)
  const failure = aggregateErrors(primary, cancelError === undefined ? [] : [cancelError], name + ' token exchange body cleanup failed')
  if (failure !== undefined) throw failure
  return cookie
}

function escapedJson(value) {
  const special = new Set(['.', '*', '+', '?', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\'])
  return [...JSON.stringify(value)].map(character => special.has(character) ? '\\' + character : character).join('')
}

function entryRecords(html, id) {
  const matcher = id === undefined
    ? /"id"\s*:\s*("(?:\\.|[^"\\])*")/gu
    : new RegExp('"id"\\s*:\\s*' + escapedJson(id), 'gu')
  const records = []
  for (const match of html.matchAll(matcher)) {
    const start = match.index ?? 0
    const next = html.slice(start + match[0].length).search(/"id"\s*:\s*"/u)
    const end = next < 0 ? html.length : start + match[0].length + next
    const segment = html.slice(start, end)
    const urlMatch = segment.match(/"url"\s*:\s*("(?:\\.|[^"\\])*")/u)
    records.push({
      id: id === undefined ? JSON.parse(match[1]) : id,
      segment,
      url: urlMatch === null ? undefined : JSON.parse(urlMatch[1]),
    })
  }
  return records
}

/**
 * Wait for the official CLI URL and remove all startup listeners on settle.
 * @param child Spawned CLI process.
 * @param stdout Bounded standard-output state.
 * @param stderr Bounded standard-error state.
 * @param name Profile label for diagnostics.
 * @param timeoutMs Startup timeout in milliseconds.
 * @returns A promise for the authenticated local URL.
 */
export function waitForProfileUrl(child, stdout, stderr, name, timeoutMs = bootTimeoutMs) {
  return new Promise((resolveUrl, reject) => {
    let settled = false
    let timer
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.off('error', onError)
      child.off('exit', onExit)
      child.stdout.off('data', onData)
      child.stderr.off('data', onData)
      callback(value)
    }
    function onError(error) {
      finish(reject, new Error(name + ' child error (' + childStatus(child, false) + ')', { cause: error }))
    }
    function onExit(code, signal) {
      finish(reject, new Error(name + ' exited before serving (timeout=false signal=' + String(signal ?? null) + ' exitCode=' + String(code ?? null) + ')\n' + stderr.text))
    }
    function onData() {
      if (stdout.overflowed || stderr.overflowed) {
        finish(reject, new Error(name + ' exceeded the bounded CLI output limit'))
        return
      }
      const match = stdout.text.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s)]+)/u)
      if (match?.[1] !== undefined) finish(resolveUrl, match[1])
    }
    timer = setTimeout(() => finish(reject, new Error(name + ' boot timed out (timeout=true signal=' + String(child.signalCode ?? null) + ' exitCode=' + String(child.exitCode ?? null) + ')\n' + stderr.text)), timeoutMs)
    child.on('error', onError)
    child.on('exit', onExit)
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
  })
}

function isOfficialCoreEntry(id) {
  return id.startsWith('@deepseek-ai/')
}

/**
 * Capture the nonempty ordered official core roster from a baseline boot.
 * @param html Baseline boot document.
 * @param name Diagnostic label.
 * @returns Ordered official core entry IDs, including duplicates.
 */
export function captureOfficialCoreRoster(html, name = 'official baseline') {
  const records = entryRecords(html)
  const core = records.filter(record => isOfficialCoreEntry(record.id)).map(record => record.id)
  if (core.length === 0) throw new Error(name + ' must expose a nonempty official @deepseek-ai/* roster')
  const nonCore = records.find(record => !isOfficialCoreEntry(record.id))
  if (nonCore !== undefined) throw new Error(name + ' contains non-core boot entry ' + nonCore.id)
  return core
}

function assertCoreRoster(html, expectedCoreRoster, name, replacedOfficialEntryId) {
  if (!Array.isArray(expectedCoreRoster) || expectedCoreRoster.length === 0) {
    throw new Error(name + ' requires a nonempty official core roster')
  }
  if (replacedOfficialEntryId !== undefined && !expectedCoreRoster.includes(replacedOfficialEntryId)) {
    throw new Error(name + ' replacement entry ' + replacedOfficialEntryId + ' is not present in the baseline roster')
  }
  const expected = replacedOfficialEntryId === undefined
    ? expectedCoreRoster
    : expectedCoreRoster.filter(id => id !== replacedOfficialEntryId)
  const actual = entryRecords(html).filter(record => isOfficialCoreEntry(record.id)).map(record => record.id)
  if (actual.length !== expected.length || actual.some((id, index) => id !== expected[index])) {
    const replacement = replacedOfficialEntryId === undefined ? '' : '; replaced ' + replacedOfficialEntryId
    throw new Error(name + ' official core roster differs from baseline (expected ' + expected.join(', ') + replacement + ', got ' + actual.join(', ') + ')')
  }
}

/**
 * Require expected mobile entries and an exact retained official core roster.
 * @param html Boot document.
 * @param expectedEntries Expected non-core entry IDs.
 * @param mobileEntryId Required mobile entry ID.
 * @param name Diagnostic label.
 * @param expectedCoreRoster Baseline official core IDs.
 * @param replacedOfficialEntryId Optional official entry replaced by a mobile entry.
 * @returns Expected entry URL map.
 */
export function assertBootEntries(html, expectedEntries, mobileEntryId, name, expectedCoreRoster = undefined, replacedOfficialEntryId = undefined) {
  const expected = new Set(expectedEntries)
  if (expected.size !== expectedEntries.length) throw new Error(name + ' expectedEntries must be unique')
  const records = entryRecords(html)
  if (expectedCoreRoster === undefined) {
    for (const record of records) {
      if (!isOfficialCoreEntry(record.id) && !expected.has(record.id)) {
        throw new Error(name + ' unexpected non-core boot entry ' + record.id)
      }
    }
  } else {
    assertCoreRoster(html, expectedCoreRoster, name, replacedOfficialEntryId)
    for (const record of records) {
      if (!isOfficialCoreEntry(record.id) && !expected.has(record.id)) {
        throw new Error(name + ' unexpected non-core boot entry ' + record.id)
      }
    }
  }
  if (mobileEntryId !== undefined && entryRecords(html, mobileEntryId).length !== 1) {
    throw new Error(name + ' expected exactly one mobile entry for ' + mobileEntryId)
  }
  const entries = {}
  for (const entry of expectedEntries) {
    const entryMatches = entryRecords(html, entry)
    if (entryMatches.length !== 1) throw new Error(name + ' expected exactly one boot entry for ' + entry)
    if (entryMatches[0].url === undefined) throw new Error(name + ' boot entry has no URL for ' + entry)
    entries[entry] = entryMatches[0].url
  }
  return entries
}

/**
 * Boot one isolated profile through the official CLI and inspect its served bundles.
 * @param options Profile, package, CLI, and manifest verification settings.
 * @returns The verified profile record.
 */
export async function bootProfile({ name, packages, expectedEntries, mobileEntryId, bundleAssertions = {}, root, cli, expectedCliHash, beforeInstall, expectedCoreRoster, replacedOfficialEntryId, captureOfficialCore = false, offline = false }) {
  const home = resolve(root, name)
  let child
  let result
  let primary
  try {
    for (const packagePath of packages) {
      assertOfficialCliDigest(cli, expectedCliHash)
      beforeInstall?.()
      run(process.execPath, [cli, 'plugin', '--profile', 'web', 'add', ...(offline ? ['--offline'] : []), packagePath], {
        env: { DSH_HOME: home },
        timeout: installTimeoutMs,
      })
    }
    assertOfficialCliDigest(cli, expectedCliHash)
    child = spawnChild(process.execPath, [cli, 'web', '--no-open', '--port', '0'], {
      env: { DSH_HOME: home },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout = { text: '', bytes: 0, overflowed: false, label: 'stdout' }
    const stderr = { text: '', bytes: 0, overflowed: false, label: 'stderr' }
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => appendBounded(stdout, chunk, 'stdout', child))
    child.stderr.on('data', chunk => appendBounded(stderr, chunk, 'stderr', child))
    const url = await waitForProfileUrl(child, stdout, stderr, name)
    const cookie = await fetchLoginCookie(url, name)
    const html = await fetchText('/', name + ' root', cookie, url)
    for (const forbidden of MOBILE_FORBIDDEN_CONTRACTS) {
      if (html.includes(forbidden)) throw new Error(name + ' boot manifest contains forbidden mobile contract ' + forbidden)
    }
    const coreRoster = captureOfficialCore
      ? captureOfficialCoreRoster(html, name)
      : expectedCoreRoster === undefined
        ? undefined
        : (assertCoreRoster(html, expectedCoreRoster, name, replacedOfficialEntryId), expectedCoreRoster)
    const urls = captureOfficialCore
      ? {}
      : assertBootEntries(html, expectedEntries, mobileEntryId, name, expectedCoreRoster, replacedOfficialEntryId)
    for (const entry of expectedEntries) {
      const source = await fetchText(urls[entry], name + ' bundle for ' + entry, cookie, url)
      for (const assertion of bundleAssertions[entry] ?? []) assertion(source)
    }
    result = { name, entries: expectedEntries, mobileEntry: mobileEntryId, coreRoster }
  } catch (error) {
    primary = error
  }
  const cleanupErrors = []
  if (child !== undefined) {
    try {
      await stopChild(child)
    } catch (error) {
      cleanupErrors.push(error)
    }
  }
  const failure = aggregateErrors(primary, cleanupErrors, name + ' cleanup failed')
  if (failure !== undefined) throw failure
  return result
}

export function includes(needle) {
  return source => {
    if (!source.includes(needle)) throw new Error('served bundle is missing ' + needle)
  }
}

export function excludes(needle) {
  return source => {
    if (source.includes(needle)) throw new Error('served bundle contains forbidden mobile contract ' + needle)
  }
}
