import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdtempSync,
  openSync,
  realpathSync,
  readFileSync,
  readSync,
  rmSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'

import { aggregateErrors, sanitizedChildEnv } from './mobile-matrix.mjs'

const sha256Pattern = /^[0-9a-f]{64}$/u

/**
 * Return the required no-follow open flag or reject unsupported platforms.
 * @param constants Filesystem constants used by the caller.
 * @returns The platform's O_NOFOLLOW flag.
 */
export function requireNoFollowFlag(constants = fsConstants) {
  if (!Number.isSafeInteger(constants.O_NOFOLLOW) || constants.O_NOFOLLOW <= 0) {
    throw new Error('strict Pairing input requires O_NOFOLLOW support')
  }
  return constants.O_NOFOLLOW
}

const noFollow = requireNoFollowFlag()
const sourceOpenFlags = fsConstants.O_RDONLY | noFollow | (fsConstants.O_NONBLOCK ?? 0)
const copyOpenFlags = fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | noFollow
const copyMode = 0o600

function requireExpectedHash() {
  const value = process.env.MOBILE_PAIRING_SHA256
  const normalized = value === undefined ? '' : value.trim().toLowerCase()
  if (value === undefined || value === '' || normalized !== value || !sha256Pattern.test(normalized)) {
    throw new Error('MOBILE_PAIRING_SHA256 must be an exact lowercase normalized 64-character hexadecimal SHA-256 digest')
  }
  return normalized
}

function requireTarballPath() {
  const value = process.env.MOBILE_PAIRING_TARBALL
  if (value === undefined || value === '') {
    throw new Error('MOBILE_PAIRING_TARBALL is required for release verification (immutable tarball)')
  }
  return resolve(value)
}

function closeDescriptor(fd, errors) {
  if (fd === undefined) return
  try {
    closeSync(fd)
  } catch (error) {
    errors.push(error)
  }
}

function writeAll(fd, bytes) {
  let offset = 0
  while (offset < bytes.length) {
    const written = writeSync(fd, bytes, offset, bytes.length - offset)
    if (written <= 0) throw new Error('strict Pairing input copy made no progress')
    offset += written
  }
}

function copyOpenedFile(sourceFd, copyFd) {
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  for (;;) {
    const length = readSync(sourceFd, buffer, 0, buffer.length, null)
    if (length === 0) return
    writeAll(copyFd, buffer.subarray(0, length))
  }
}

function hashOpenedFile(fd) {
  const hash = createHash('sha256')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  for (;;) {
    const length = readSync(fd, buffer, 0, buffer.length, null)
    if (length === 0) return hash.digest('hex')
    hash.update(buffer.subarray(0, length))
  }
}

function hashRegularFile(path, label) {
  let fd
  let digest
  let primary
  try {
    fd = openSync(path, sourceOpenFlags)
    if (!fstatSync(fd).isFile()) throw new Error(label + ' is not a regular file: ' + path)
    digest = hashOpenedFile(fd)
  } catch (error) {
    primary = error
  }
  const cleanupErrors = []
  closeDescriptor(fd, cleanupErrors)
  const failure = aggregateErrors(primary, cleanupErrors, label + ' hash cleanup failed')
  if (failure !== undefined) throw failure
  return digest
}

function assertExpectedHash(path, expectedHash, label = 'MOBILE_PAIRING_TARBALL') {
  const actualHash = hashRegularFile(path, label)
  if (actualHash !== expectedHash) {
    throw new Error(label + ' does not match MOBILE_PAIRING_SHA256 (expected ' + expectedHash + ', got ' + actualHash + ')')
  }
}

function sourceOpenError(sourcePath, error) {
  if (error?.code === 'ENOENT') return new Error('MOBILE_PAIRING_TARBALL not found: ' + sourcePath, { cause: error })
  if (error?.code === 'ELOOP') return new Error('MOBILE_PAIRING_TARBALL must be a non-symlink regular file: ' + sourcePath, { cause: error })
  return error
}

function removePrivateTempDir(tempDir) {
  let stat
  try {
    stat = lstatSync(tempDir)
  } catch (error) {
    if (error?.code === 'ENOENT') return
    throw new Error('strict Pairing temporary directory could not be inspected', { cause: error })
  }
  if (stat.isSymbolicLink()) {
    try {
      unlinkSync(tempDir)
    } catch (error) {
      throw new Error('strict Pairing temporary directory link could not be unlinked', { cause: error })
    }
    return
  }
  if (!stat.isDirectory()) {
    rmSync(tempDir, { force: true })
    return
  }
  let canonical
  try {
    canonical = realpathSync(tempDir)
  } catch (error) {
    throw new Error('strict Pairing temporary directory could not be resolved', { cause: error })
  }
  if (canonical !== tempDir) {
    try {
      unlinkSync(tempDir)
    } catch (error) {
      throw new Error('strict Pairing temporary directory link could not be unlinked', { cause: error })
    }
    return
  }
  rmSync(tempDir, { recursive: true, force: true })
}

function copyStrictInput(sourcePath, expectedHash) {
  let tempDir
  let sourceFd
  let copyFd
  let copyPath
  let primary
  try {
    tempDir = mkdtempSync(join(tmpdir(), 'dsh-mobile-pairing-input-'))
    const allocatedStat = lstatSync(tempDir)
    if (!allocatedStat.isDirectory() || allocatedStat.isSymbolicLink()) {
      throw new Error('strict Pairing temporary directory was not allocated as a real directory: ' + tempDir)
    }
    const allocatedPath = tempDir
    tempDir = realpathSync(allocatedPath)
    if (tempDir !== allocatedPath) throw new Error('strict Pairing temporary directory escaped its allocated path: ' + allocatedPath)
    chmodSync(tempDir, 0o700)
    try {
      sourceFd = openSync(sourcePath, sourceOpenFlags)
    } catch (error) {
      throw sourceOpenError(sourcePath, error)
    }
    if (!fstatSync(sourceFd).isFile()) throw new Error('MOBILE_PAIRING_TARBALL is not a regular file: ' + sourcePath)
    copyPath = join(tempDir, 'pairing.tgz')
    copyFd = openSync(copyPath, copyOpenFlags, copyMode)
    copyOpenedFile(sourceFd, copyFd)
    fsyncSync(copyFd)
    closeSync(copyFd)
    copyFd = undefined
    assertExpectedHash(copyPath, expectedHash)
  } catch (error) {
    primary = error
  }
  const descriptorErrors = []
  closeDescriptor(copyFd, descriptorErrors)
  closeDescriptor(sourceFd, descriptorErrors)
  if (primary !== undefined || descriptorErrors.length > 0) {
    const cleanupErrors = [...descriptorErrors]
    if (tempDir !== undefined) {
      try {
        removePrivateTempDir(tempDir)
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    const failure = aggregateErrors(primary, cleanupErrors, 'strict Pairing input preparation failed')
    if (failure !== undefined) throw failure
  }
  return { tempDir, copyPath }
}

function recheckSource(sourcePath, expectedHash) {
  try {
    assertExpectedHash(sourcePath, expectedHash, 'MOBILE_PAIRING_TARBALL source')
  } catch (error) {
    throw new Error('MOBILE_PAIRING_TARBALL source recheck failed; the caller path changed after copying', { cause: error })
  }
}

function createCleanup(tempDir) {
  let attempted = false
  return () => {
    if (attempted) return
    attempted = true
    removePrivateTempDir(tempDir)
  }
}

function preparePrivateArtifact(sourcePath, expectedHash) {
  const { tempDir, copyPath } = copyStrictInput(sourcePath, expectedHash)
  return {
    tarball: copyPath,
    expectedHash,
    sourceTarball: sourcePath,
    recheckSource: () => recheckSource(sourcePath, expectedHash),
    cleanup: createCleanup(tempDir),
  }
}

/**
 * Resolve and copy the authenticated strict Pairing input before any inspection or execution.
 * @returns A private tarball selection with source evidence and cleanup hooks.
 */
export function resolvePairingArtifactStrict() {
  if (process.env.MOBILE_PAIRING_ROOT !== undefined) {
    throw new Error('MOBILE_PAIRING_ROOT is forbidden by strict verification; use MOBILE_PAIRING_TARBALL')
  }
  const expectedHash = requireExpectedHash()
  return preparePrivateArtifact(requireTarballPath(), expectedHash)
}

function readManifestFromTarball(tarball) {
  const json = execFileSync('tar', ['-xOf', tarball, 'package/package.json'], {
    encoding: 'utf8',
    timeout: 10_000,
    maxBuffer: 256 * 1024,
    env: sanitizedChildEnv(),
  })
  return JSON.parse(json)
}

/**
 * Read the package manifest from the authenticated private strict Pairing copy.
 * @returns A strict selection whose tarball points only to private temporary storage.
 */
export function resolvePairingManifestStrict() {
  const artifact = resolvePairingArtifactStrict()
  let selection
  let primary
  try {
    selection = {
      manifest: readManifestFromTarball(artifact.tarball),
      label: artifact.tarball + ':package/package.json',
      root: null,
      ...artifact,
    }
  } catch (error) {
    primary = error
  }
  if (primary !== undefined) {
    const cleanupErrors = []
    try {
      artifact.recheckSource()
    } catch (error) {
      cleanupErrors.push(error)
    }
    try {
      artifact.cleanup()
    } catch (error) {
      cleanupErrors.push(error)
    }
    const failure = aggregateErrors(primary, cleanupErrors, 'strict Pairing manifest cleanup failed')
    if (failure !== undefined) throw failure
  }
  return selection
}

/**
 * Resolve one explicitly selected development source or tarball.
 * @returns A development Pairing selection.
 */
export function resolvePairingManifestDev() {
  const tarballValue = process.env.MOBILE_PAIRING_TARBALL
  const rootValue = process.env.MOBILE_PAIRING_ROOT
  const hasTarball = tarballValue !== undefined && tarballValue !== ''
  const hasRoot = rootValue !== undefined && rootValue !== ''
  if (hasTarball && hasRoot) throw new Error('choose exactly one of MOBILE_PAIRING_TARBALL or MOBILE_PAIRING_ROOT')
  if (hasTarball) {
    const tarball = requireTarballPath()
    return { manifest: readManifestFromTarball(tarball), label: tarball + ':package/package.json', tarball, root: null }
  }
  if (hasRoot) {
    const root = resolve(rootValue)
    const packageJson = resolve(root, 'package.json')
    try {
      return { manifest: JSON.parse(readFileSync(packageJson, 'utf8')), label: packageJson, tarball: null, root }
    } catch (error) {
      if (error?.code === 'ENOENT') throw new Error('MOBILE_PAIRING_ROOT package.json not found: ' + packageJson, { cause: error })
      throw error
    }
  }
  throw new Error('set exactly one of MOBILE_PAIRING_TARBALL or MOBILE_PAIRING_ROOT for development verification')
}
