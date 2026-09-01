import { existsSync, lstatSync, readlinkSync, realpathSync, symlinkSync, unlinkSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const link = resolve(root, '.dsh-upstream')
const required = 'packages/client/store/package.json'

function valid(target) { return existsSync(resolve(target, required)) }
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
  throw new Error('dsh-mobile: set DSH_UPSTREAM to a DSH >=0.1.2 checkout containing ' + required)
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
