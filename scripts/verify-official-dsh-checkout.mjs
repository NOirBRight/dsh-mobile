import { execFileSync } from 'node:child_process'
import process from 'node:process'
import { chmodSync, cpSync, lstatSync, mkdtempSync, realpathSync, rmSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { aggregateErrors, run, sanitizedChildEnv, sha256File } from './mobile-matrix.mjs'

const OFFICIAL_REPOSITORY = 'deepseek-ai/deepseek-harness'
export const REQUIRED_DSH_REVISION = '4e84901e6471b79ec0338099867ebb4606d12bb5'
export const REQUIRED_DSH_TAG = 'dsh-v0.1.2-alpha.4'

function repositoryOf(remote) {
  return remote
    .trim()
    .replace(/^git@github\.com:/, '')
    .replace(/^ssh:\/\/git@github\.com\//, '')
    .replace(/^https?:\/\/github\.com\//, '')
    .replace(/\.git$/, '')
}

export function assessOfficialDshCheckout({ remote, status, head, tag }) {
  const reasons = []
  if (repositoryOf(remote) !== OFFICIAL_REPOSITORY) {
    reasons.push('origin is not deepseek-ai/deepseek-harness')
  }
  if (status.trim() !== '') {
    reasons.push('official DSH checkout has local changes')
  }
  if (head.trim() !== REQUIRED_DSH_REVISION) {
    reasons.push('official DSH revision does not match the required baseline')
  }
  if (typeof tag !== 'string' || tag.trim() !== REQUIRED_DSH_TAG) {
    reasons.push('official DSH checkout is not exactly tagged ' + REQUIRED_DSH_TAG)
  }
  return reasons.length === 0
    ? { ok: true, revision: head.trim() }
    : { ok: false, reasons }
}

function git(checkout, ...args) {
  return execFileSync('git', ['-C', checkout, ...args], {
    encoding: 'utf8',
    timeout: 10_000,
    env: sanitizedChildEnv(),
  }).trim()
}

function inspectOfficialDshMetadata(checkout) {
  return assessOfficialDshCheckout({
    remote: git(checkout, 'config', '--get', 'remote.origin.url'),
    status: '',
    head: git(checkout, 'rev-parse', 'HEAD'),
    tag: git(checkout, 'tag', '--points-at', 'HEAD'),
  })
}

export function inspectOfficialDshCheckout(checkout) {
  return assessOfficialDshCheckout({
    remote: git(checkout, 'config', '--get', 'remote.origin.url'),
    status: git(checkout, 'status', '--porcelain'),
    head: git(checkout, 'rev-parse', 'HEAD'),
    tag: git(checkout, 'tag', '--points-at', 'HEAD'),
  })
}
function assertNoNonIgnoredOutputs(checkout, phase) {
  const status = git(checkout, 'status', '--porcelain')
  if (status !== '') {
    throw new Error('official DSH checkout has non-ignored ' + phase + ' changes: ' + status.replaceAll('\n', '; '))
  }
}

function assertNoTrackedCoreChanges(checkout, phase) {
  const changed = git(checkout, 'diff', '--name-only', '--', 'packages/core')
  const staged = git(checkout, 'diff', '--cached', '--name-only', '--', 'packages/core')
  if (changed !== '' || staged !== '') throw new Error('official DSH Core has tracked ' + phase + ' changes')
}

/**
 * Require the fresh official CLI output to be a non-symlink regular file.
 * @param cli CLI output path.
 * @returns Nothing when the output is valid.
 */
export function assertFreshOfficialCli(cli) {
  let stat
  try {
    stat = lstatSync(cli)
  } catch (error) {
    throw new Error('official DSH CLI was not newly built: ' + cli, { cause: error })
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('official DSH CLI must be a newly built regular file: ' + cli)
  }
}

function isContainedPath(root, candidate) {
  const child = relative(root, candidate)
  return child !== '' && child !== '..' && !child.startsWith('..' + sep) && !isAbsolute(child)
}

function assertRealDirectory(path, label) {
  const resolved = resolve(path)
  let stat
  try {
    stat = lstatSync(resolved)
  } catch (error) {
    throw new Error(label + ' is not an available directory: ' + resolved, { cause: error })
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(label + ' must be a real directory: ' + resolved)
  }
  let canonical
  try {
    canonical = realpathSync(resolved)
  } catch (error) {
    throw new Error(label + ' could not be resolved: ' + resolved, { cause: error })
  }
  if (canonical !== resolved) throw new Error(label + ' changed while it was being allocated: ' + resolved)
  return canonical
}

function removeBuildRoot(root) {
  let stat
  try {
    stat = lstatSync(root)
  } catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }
  if (stat.isSymbolicLink()) {
    unlinkSync(root)
    return
  }
  if (!stat.isDirectory()) {
    rmSync(root, { force: true })
    return
  }
  const canonical = realpathSync(root)
  if (canonical !== resolve(root)) {
    unlinkSync(root)
    return
  }
  rmSync(root, { recursive: true, force: true })
}

function allocateBuildRoot(destination) {
  const parent = destination === undefined
    ? realpathSync(tmpdir())
    : assertRealDirectory(destination, 'official DSH temporary parent')
  const root = mkdtempSync(join(parent, 'dsh-official-cli-build-'))
  assertRealDirectory(root, 'official DSH temporary build directory')
  chmodSync(root, 0o700)
  return root
}

function copyOfficialTree(source, destination) {
  cpSync(source, destination, {
    recursive: true,
    dereference: false,
    force: false,
    errorOnExist: true,
    filter: sourcePath => {
      const child = relative(source, sourcePath)
      if (child === '') return true
      if (child.split(sep).includes('node_modules')) return false
      const stat = lstatSync(sourcePath)
      return stat.isDirectory() || stat.isFile()
    },
  })
  assertRealDirectory(destination, 'copied official DSH checkout')
}

/**
 * Copy the exact official source into an isolated directory, build its CLI, and hash it.
 * Source links and other non-regular paths are skipped; ignored dependencies are recreated in the copy.
 * @param checkout Official DSH provenance checkout selected by the caller.
 * @param destination Existing isolated parent for the temporary build directory.
 * @returns The exact built revision, copied checkout, source checkout, and CLI digest.
 */
export function prepareOfficialDshCheckout(checkout, destination = undefined) {
  const provenanceCheckout = resolve(checkout ?? resolve(dirname(fileURLToPath(import.meta.url)), '..', '.dsh-upstream'))
  const sourceCheckout = realpathSync(provenanceCheckout)
  const before = inspectOfficialDshCheckout(sourceCheckout)
  if (!before.ok) throw new Error(before.reasons.join('; '))
  assertNoNonIgnoredOutputs(sourceCheckout, 'source')
  assertNoTrackedCoreChanges(sourceCheckout, 'source')
  const buildRoot = allocateBuildRoot(destination)
  if (isContainedPath(sourceCheckout, buildRoot) || isContainedPath(buildRoot, sourceCheckout)) {
    removeBuildRoot(buildRoot)
    throw new Error('official DSH source overlaps its isolated build directory')
  }
  const copiedCheckout = resolve(buildRoot, 'checkout')
  try {
    copyOfficialTree(sourceCheckout, copiedCheckout)
    const copiedBefore = inspectOfficialDshMetadata(copiedCheckout)
    if (!copiedBefore.ok) throw new Error(copiedBefore.reasons.join('; '))
    if (copiedBefore.revision !== REQUIRED_DSH_REVISION || copiedBefore.revision !== before.revision) {
      throw new Error('copied official DSH source revision does not match the required baseline')
    }
    run('pnpm', ['install', '--offline', '--frozen-lockfile', '--ignore-scripts'], { cwd: copiedCheckout, env: { DSH_UPSTREAM: copiedCheckout } })
    run('pnpm', ['run', 'clean'], { cwd: copiedCheckout, env: { DSH_UPSTREAM: copiedCheckout } })
    run('pnpm', ['run', 'build'], { cwd: copiedCheckout, env: { DSH_UPSTREAM: copiedCheckout } })
    const cli = resolve(copiedCheckout, 'apps', 'cli', 'lib', 'bin.js')
    assertFreshOfficialCli(cli)
    const cliHash = sha256File(cli)
    assertFreshOfficialCli(cli)
    const after = inspectOfficialDshMetadata(copiedCheckout)
    if (!after.ok) throw new Error(after.reasons.join('; '))
    if (after.revision !== REQUIRED_DSH_REVISION || after.revision !== before.revision) {
      throw new Error('built official DSH CLI revision does not match the required baseline')
    }
    const sourceAfter = inspectOfficialDshCheckout(sourceCheckout)
    if (!sourceAfter.ok || sourceAfter.revision !== before.revision) {
      throw new Error('official DSH provenance checkout changed during isolated build')
    }
    return { ...after, checkout: copiedCheckout, sourceCheckout, provenanceCheckout, cli, cliHash, cleanup: () => removeBuildRoot(buildRoot) }
  } catch (error) {
    const cleanupErrors = []
    try {
      removeBuildRoot(buildRoot)
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError)
    }
    const failure = aggregateErrors(error, cleanupErrors, 'official DSH isolated build failed')
    throw failure
  }
}

function main() {
  const scriptDir = dirname(fileURLToPath(import.meta.url))
  const checkout = process.env.DSH_UPSTREAM ?? resolve(scriptDir, '..', '.dsh-upstream')
  const result = inspectOfficialDshCheckout(checkout)
  if (!result.ok) {
    console.error(result.reasons.map(reason => checkout + ': ' + reason).join('\n'))
    process.exitCode = 1
    return
  }
  console.log(JSON.stringify({ checkout, cleanOfficialDsh: true, revision: result.revision }, null, 2))
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main()
