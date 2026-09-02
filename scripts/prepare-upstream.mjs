import { existsSync, lstatSync, readlinkSync, realpathSync, symlinkSync, unlinkSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const link = resolve(root, '.dsh-upstream')
const required = 'packages/client/store/package.json'
const requiredRevision = '4e84901e6471b79ec0338099867ebb4606d12bb5'
const requiredTag = 'dsh-v0.1.2-alpha.4'

function git(target, ...args) {
  try {
    return execFileSync('git', ['-C', target, ...args], { encoding: 'utf8' }).trim()
  } catch { return undefined }
}

function valid(target) {
  if (!existsSync(resolve(target, required))) return false
  return git(target, 'rev-parse', 'HEAD') === requiredRevision
    && git(target, 'tag', '--points-at', 'HEAD')?.split(/\s+/u).includes(requiredTag) === true
    && git(target, 'status', '--porcelain') === ''
}
function current() {
  try {
    const raw = readlinkSync(link)
    return isAbsolute(raw) ? raw : resolve(root, raw)
  } catch { return undefined }
}

const requested = process.env.DSH_UPSTREAM === undefined
  ? undefined
  : realpathSync(resolve(process.env.DSH_UPSTREAM))
const existing = current()
const candidates = [requested, existing, resolve(root, '../deepseek-harness')]
const target = candidates.find(value => value !== undefined && valid(value))
if (target === undefined) {
  throw new Error('dsh-mobile: set DSH_UPSTREAM to the clean official ' + requiredTag + ' checkout (' + requiredRevision + ') containing ' + required)
}
if (existing === target) process.exit(0)
let existingStat
try {
  existingStat = lstatSync(link)
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}
if (existingStat !== undefined) {
  if (!existingStat.isSymbolicLink()) throw new Error('dsh-mobile: .dsh-upstream exists and is not a symlink')
  unlinkSync(link)
}
symlinkSync(target, link, 'dir')
console.log('dsh-mobile: .dsh-upstream -> ' + target)
