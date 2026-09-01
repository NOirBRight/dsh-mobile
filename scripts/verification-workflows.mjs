import assert from 'node:assert/strict'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import {
  DESKTOP_LAYOUT_ID,
  INTERACTION_OPERATIONS_ID,
  MOBILE_LAYOUT_ID,
  RUNTIME_ID,
  selectResponsiveBootManifest,
} from '../apps/mobile-web/src/manifest.ts'
import {
  prepareOfficialDshCheckout,
  REQUIRED_DSH_REVISION,
  REQUIRED_DSH_TAG,
} from './verify-official-dsh-checkout.mjs'
import {
  MOBILE_FORBIDDEN_CONTRACTS,
  aggregateErrors,
  assertPairingManifest,
  assertStrictPairingPolicy,
  assertUnchanged,
  bootProfile,
  excludes,
  inspectPairingArtifact,
  pack,
  run,
  sha256File,
} from './mobile-matrix.mjs'

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const localPairingMirrors = [
  resolve(project, 'plugins', 'pairing'),
  resolve(project, 'packages', 'pairing'),
  resolve(project, 'pairing'),
  resolve(project, 'plugins', 'dsh-mobile-pairing'),
  resolve(project, 'packages', 'dsh-mobile-pairing'),
  resolve(project, 'dsh-mobile-pairing'),
]

/** Select the execution safeguards shared by strict and development wrappers. */
export const VERIFICATION_MODES = Object.freeze({ strict: 'strict', development: 'development' })

function assertMode(mode) {
  if (mode !== VERIFICATION_MODES.strict && mode !== VERIFICATION_MODES.development) {
    throw new Error('unknown verification mode: ' + String(mode))
  }
}

function isStrict(mode) {
  return mode === VERIFICATION_MODES.strict
}

function selectionTarball(selection) {
  return selection.tarball ?? null
}

function selectionRoot(selection) {
  return selection.root ?? null
}

function selectionHash(selection) {
  return selection.expectedHash ?? null
}

function assertSelection(selection, mode) {
  const tarball = selectionTarball(selection)
  const root = selectionRoot(selection)
  if (isStrict(mode)) {
    if (root !== null) throw new Error('strict verification cannot select MOBILE_PAIRING_ROOT')
    if (tarball === null || selectionHash(selection) === null) {
      throw new Error('strict verification requires an authenticated Pairing tarball')
    }
  } else if (tarball === null && root === null) {
    throw new Error('development verification requires a Pairing tarball or explicit root')
  }
  if (selection.manifest === undefined || selection.manifest === null) {
    throw new Error('Pairing selection has no package manifest')
  }
  if (isStrict(mode)) assertArtifactHash(tarball, selectionHash(selection), 'MOBILE_PAIRING_TARBALL')
}

function assertArtifactHash(tarball, expectedHash, label) {
  if (tarball !== null && expectedHash !== null) assertUnchanged(tarball, expectedHash, label)
}

function assertMobilePackageWorkspaces() {
  const packageJson = JSON.parse(readFileSync(resolve(project, 'package.json'), 'utf8'))
  const workspaces = packageJson.workspaces ?? []
  if (workspaces.some(workspace => {
    if (typeof workspace !== 'string') return false
    const normalized = workspace.replaceAll('\\', '/')
    return /(?:^|\/)(?:plugins\/(?:\*|pairing)|packages\/pairing|pairing)(?:\/|$)/u.test(normalized)
  })) {
    throw new Error('dsh-mobile workspaces must not include a local Pairing mirror')
  }
  const mirror = localPairingMirrors.find(path => existsSync(path))
  if (mirror !== undefined) throw new Error('dsh-mobile must not contain a local Pairing source mirror: ' + mirror)
}

function strictPairingLabel(selection, tarball) {
  return selection.label ?? tarball + ':package/package.json'
}

function assertPairingRuntimeDependencies(manifest, label) {
  const dependencies = { ...manifest.dependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies }
  assert.equal(dependencies['@dsh-mobile/session-hydration'], undefined, label + ' must not depend on session-hydration')
  assert.equal(dependencies['@deepseek-ai/dsh-client-runtime'], undefined, label + ' must not depend on dsh-client-runtime')
}

function assertStrictArtifact(selection, artifact, label) {
  assertStrictPairingPolicy(artifact.manifest, artifact.entries, label)
  if (selection.manifest !== artifact.manifest && JSON.stringify(selection.manifest) !== JSON.stringify(artifact.manifest)) {
    throw new Error(label + ' manifest changed between selection and packed inspection')
  }
}

function removeTemporaryRoot(tempRoot) {
  let stat
  try {
    stat = lstatSync(tempRoot)
  } catch (error) {
    if (error?.code === 'ENOENT') return
    throw new Error('temporary root could not be inspected', { cause: error })
  }
  if (stat.isSymbolicLink()) {
    try {
      unlinkSync(tempRoot)
    } catch (error) {
      throw new Error('temporary root link could not be unlinked', { cause: error })
    }
    return
  }
  if (!stat.isDirectory()) {
    rmSync(tempRoot, { force: true })
    return
  }
  let canonical
  try {
    canonical = realpathSync(tempRoot)
  } catch (error) {
    throw new Error('temporary root could not be resolved', { cause: error })
  }
  if (canonical !== tempRoot) {
    try {
      unlinkSync(tempRoot)
    } catch (error) {
      throw new Error('temporary root link could not be unlinked', { cause: error })
    }
    return
  }
  rmSync(tempRoot, { recursive: true, force: true })
}

function allocateTemporaryRoot(prefix) {
  const allocatedRoot = mkdtempSync(join(tmpdir(), prefix))
  try {
    const stat = lstatSync(allocatedRoot)
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('temporary root was not allocated as a real directory: ' + allocatedRoot)
    const canonical = realpathSync(allocatedRoot)
    if (canonical !== allocatedRoot) throw new Error('temporary root escaped its allocated path: ' + allocatedRoot)
    return canonical
  } catch (primary) {
    try {
      removeTemporaryRoot(allocatedRoot)
    } catch (cleanup) {
      throw aggregateErrors(primary, [cleanup], 'temporary root allocation cleanup failed')
    }
    throw primary
  }
}

async function withTemporaryRoot(prefix, callback) {
  const tempRoot = allocateTemporaryRoot(prefix)
  let result
  let primary
  try {
    result = await callback(tempRoot)
  } catch (error) {
    primary = error
  }
  const cleanupErrors = []
  try {
    removeTemporaryRoot(tempRoot)
  } catch (error) {
    cleanupErrors.push(error)
  }
  const failure = aggregateErrors(primary, cleanupErrors, 'temporary root cleanup failed')
  if (failure !== undefined) throw failure
  return result
}

async function withSelectionCleanup(selection, callback) {
  let result
  let primary
  try {
    result = await callback()
  } catch (error) {
    primary = error
  }
  const cleanupErrors = []
  if (typeof selection.recheckSource === 'function') {
    try {
      selection.recheckSource()
    } catch (error) {
      cleanupErrors.push(error)
    }
  }
  if (typeof selection.cleanup === 'function') {
    try {
      selection.cleanup()
    } catch (error) {
      cleanupErrors.push(error)
    }
  }
  const failure = aggregateErrors(primary, cleanupErrors, 'Pairing input cleanup failed')
  if (failure !== undefined) throw failure
  return result
}

function withSelectionCleanupSync(selection, callback) {
  let result
  let primary
  try {
    result = callback()
  } catch (error) {
    primary = error
  }
  const cleanupErrors = []
  if (typeof selection.recheckSource === 'function') {
    try {
      selection.recheckSource()
    } catch (error) {
      cleanupErrors.push(error)
    }
  }
  if (typeof selection.cleanup === 'function') {
    try {
      selection.cleanup()
    } catch (error) {
      cleanupErrors.push(error)
    }
  }
  const failure = aggregateErrors(primary, cleanupErrors, 'Pairing input cleanup failed')
  if (failure !== undefined) throw failure
  return result
}

/**
 * Run the Pairing artifact gate for either strict release or development input.
 * @param options Resolver and verification mode selected by the thin wrapper.
 * @returns A promise that resolves after artifact cleanup.
 */
export async function runPairingArtifactVerification({ mode, resolvePairing }) {
  assertMode(mode)
  const selection = resolvePairing()
  return await withSelectionCleanup(selection, async () => {
    assertSelection(selection, mode)
    if (!isStrict(mode)) console.warn('[development-only] Pairing artifact verification is not release evidence')
    return await withTemporaryRoot('dsh-mobile-artifact-' + mode + '-', async tempRoot => {
      let tarball = selectionTarball(selection)
      let expectedHash = selectionHash(selection)
      if (isStrict(mode)) {
        assertMobilePackageWorkspaces()
      } else if (tarball === null) {
        mkdirSync(tempRoot, { recursive: true })
        tarball = pack(selectionRoot(selection), tempRoot)
        expectedHash = sha256File(tarball)
      } else {
        if (!existsSync(tarball)) throw new Error('MOBILE_PAIRING_TARBALL not found: ' + tarball)
        inspectPairingArtifact(tarball)
        expectedHash = sha256File(tarball)
        assertArtifactHash(tarball, expectedHash, 'MOBILE_PAIRING_TARBALL')
      }
      const artifact = inspectPairingArtifact(tarball)
      const manifestLabel = strictPairingLabel(selection, tarball)
      if (isStrict(mode)) assertStrictArtifact(selection, artifact, manifestLabel)
      assertArtifactHash(tarball, expectedHash, isStrict(mode) ? 'MOBILE_PAIRING_TARBALL' : 'Pairing development artifact')
      console.log(JSON.stringify({
        pairingVerification: isStrict(mode) ? 'ok' : 'ok (development-only)',
        pairingSource: isStrict(mode) ? undefined : selectionRoot(selection) === null ? 'tarball' : 'explicit root',
        manifest: manifestLabel,
        version: artifact.manifest.version,
        exports: Object.keys(artifact.manifest.exports ?? {}),
        pairingTarballSha256: expectedHash,
        releaseEvidence: isStrict(mode) ? undefined : false,
      }, null, 2))
    })
  })
}

function assertBootManifestCompatibility() {
  const runtime = {
    id: RUNTIME_ID, url: '/plugins/runtime.js', rev: 'official-runtime',
    inject: ['@deepseek-ai/dsh-client-ui-renderer'], immediately: true,
  }
  const layout = {
    id: DESKTOP_LAYOUT_ID, url: '/plugins/layout.js', rev: 'layout',
    inject: ['@deepseek-ai/dsh-client-ui-renderer', '@deepseek-ai/dsh-client-ui-session', '@deepseek-ai/dsh-client-ui-theme'],
  }
  const host = { rev: 'official', entries: [runtime, layout] }
  const core = selectResponsiveBootManifest(host, { viewportWidth: 390 })
  assert.equal(core.layout, 'narrow')
  assert.equal(core.compatibility, 'compatible')
  assert.ok(core.manifest.entries.some(entry => entry.id === MOBILE_LAYOUT_ID))
  assert.ok(core.manifest.entries.some(entry => entry.id === INTERACTION_OPERATIONS_ID))
  assert.ok(core.manifest.entries.some(entry => entry.id === RUNTIME_ID && entry.url === '/plugins/runtime.js'))
  assert.ok(!JSON.stringify(core.manifest).includes('session-hydration'))
  const official = selectResponsiveBootManifest(host, { viewportWidth: 1280 })
  assert.equal(official.layout, 'official')
  assert.equal(official.manifest.entries.find(entry => entry.id === RUNTIME_ID)?.url, '/plugins/runtime.js')
  assert.ok(official.manifest.entries.some(entry => entry.id === INTERACTION_OPERATIONS_ID))
  assert.ok(!JSON.stringify(official.manifest).includes('session-hydration'))
}

/**
 * Run the two-tier boot and Pairing metadata verifier in one implementation.
 * @param options Resolver and verification mode selected by the thin wrapper.
 * @returns Nothing; failures set a non-zero process exit status.
 */
export function runTwoTierCompatibility({ mode, resolvePairing }) {
  assertMode(mode)
  assertBootManifestCompatibility()
  const selection = resolvePairing()
  return withSelectionCleanupSync(selection, () => {
    assertSelection(selection, mode)
    const tarball = selectionTarball(selection)
    const expectedHash = selectionHash(selection)
    if (isStrict(mode)) {
      const artifact = inspectPairingArtifact(tarball)
      assertStrictArtifact(selection, artifact, strictPairingLabel(selection, tarball))
    } else {
      assertPairingManifest(selection.manifest, selection.label)
      assertPairingRuntimeDependencies(selection.manifest, selection.label)
    }
    assertArtifactHash(tarball, expectedHash, 'MOBILE_PAIRING_TARBALL')
    console.log(JSON.stringify({
      alwaysCore: true,
      noHydrationInBoot: true,
      pairingCoreIndependent: true,
      releaseEvidence: isStrict(mode) ? undefined : false,
    }, null, 2))
  })
}

function mobileMatrixSelection(selection, mode, packDirectory) {
  let tarball = selectionTarball(selection)
  let expectedHash = selectionHash(selection)
  if (tarball === null) {
    tarball = pack(selectionRoot(selection), packDirectory)
    expectedHash = sha256File(tarball)
  } else if (!existsSync(tarball)) {
    throw new Error('MOBILE_PAIRING_TARBALL not found: ' + tarball)
  } else if (expectedHash === null) {
    expectedHash = sha256File(tarball)
  }
  assertArtifactHash(tarball, expectedHash, isStrict(mode) ? 'MOBILE_PAIRING_TARBALL' : 'Pairing development artifact')
  return { tarball, expectedHash }
}

/**
 * Run the isolated alpha1 mobile matrix for either strict release or development input.
 * @param options Resolver and verification mode selected by the thin wrapper.
 * @returns A promise that resolves after the isolated profile is removed.
 */
export async function runCleanAlpha1MobileMatrix({ mode, resolvePairing }) {
  assertMode(mode)
  const selection = resolvePairing()
  return await withSelectionCleanup(selection, async () => {
    assertSelection(selection, mode)
    const provenanceCheckout = resolve(process.env.DSH_UPSTREAM ?? resolve(project, '.dsh-upstream'))
    const interactionRoot = resolve(project, 'packages/interaction-operations')
    const layoutRoot = resolve(project, 'packages/ui-layout-mobile')
    const sourceSelection = selectionRoot(selection) === null ? 'tarball' : 'explicit root'
    if (!isStrict(mode)) console.warn('[development-only] this matrix is not release evidence (' + sourceSelection + '; strict verification requires MOBILE_PAIRING_TARBALL)')
    return await withTemporaryRoot('dsh-mobile-matrix-' + mode + '-', async tempRoot => {
      const packDirectory = resolve(tempRoot, 'packs')
      mkdirSync(packDirectory, { recursive: true })
      const artifact = mobileMatrixSelection(selection, mode, packDirectory)
      const artifactInspection = inspectPairingArtifact(artifact.tarball)
      if (isStrict(mode)) {
        assertMobilePackageWorkspaces()
        assertStrictArtifact(selection, artifactInspection, strictPairingLabel(selection, artifact.tarball))
      }
      const checkoutResult = prepareOfficialDshCheckout(provenanceCheckout, tempRoot)
      const cli = checkoutResult.cli
      const expectedCliHash = checkoutResult.cliHash
      const officialEnv = { DSH_UPSTREAM: checkoutResult.sourceCheckout }
      run('npm', ['run', 'typecheck'], { cwd: project, env: officialEnv })
      run('npm', ['test'], { cwd: project, env: officialEnv })
      run('npm', ['run', 'audit:architecture'], { cwd: project, env: officialEnv })
      run('npm', ['run', 'build'], { cwd: project, env: officialEnv })
      const interactionPackage = pack(interactionRoot, packDirectory)
      const layoutPackage = pack(layoutRoot, packDirectory)
      const cleanBundle = MOBILE_FORBIDDEN_CONTRACTS.map(excludes)
      const bundleAssertions = {
        '@dsh-mobile/pairing': cleanBundle,
        '@dsh-mobile/interaction-operations': cleanBundle,
        '@dsh-mobile/ui-layout-mobile': cleanBundle,
      }
      const baseline = await bootProfile({
        name: 'official-baseline',
        packages: [],
        expectedEntries: [],
        root: tempRoot,
        cli,
        expectedCliHash,
        captureOfficialCore: true,
      })
      const profiles = [await bootProfile({
        name: 'mobile',
        packages: [artifact.tarball, interactionPackage, layoutPackage],
        expectedEntries: [
          '@dsh-mobile/pairing',
          '@dsh-mobile/interaction-operations',
          '@dsh-mobile/ui-layout-mobile',
        ],
        mobileEntryId: '@dsh-mobile/ui-layout-mobile',
        bundleAssertions,
        root: tempRoot,
        cli,
        expectedCliHash,
        expectedCoreRoster: baseline.coreRoster,
        replacedOfficialEntryId: DESKTOP_LAYOUT_ID,
        beforeInstall: () => assertArtifactHash(artifact.tarball, artifact.expectedHash, isStrict(mode) ? 'MOBILE_PAIRING_TARBALL' : 'Pairing development artifact'),
      })]
      assertArtifactHash(artifact.tarball, artifact.expectedHash, isStrict(mode) ? 'MOBILE_PAIRING_TARBALL' : 'Pairing development artifact')
      console.log(JSON.stringify({
        cleanOfficialDsh: checkoutResult.revision,
        requiredDshRevision: REQUIRED_DSH_REVISION,
        requiredDshTag: REQUIRED_DSH_TAG,
        pairingSource: isStrict(mode) ? undefined : sourceSelection,
        pairingTarballSha256: artifact.expectedHash,
        officialCoreRoster: baseline.coreRoster,
        packedProfiles: profiles,
        releaseEvidence: isStrict(mode) ? undefined : false,
      }, null, 2))
      checkoutResult.cleanup()
    })
  })
}
