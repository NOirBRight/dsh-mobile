import { existsSync, lstatSync, readlinkSync, rmSync, symlinkSync } from 'node:fs'
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

const requested = process.env.DSH_UPSTREAM === undefined ? undefined : resolve(process.env.DSH_UPSTREAM)
const existing = current()
const candidates = [requested, existing, resolve(root, '../deepseek-harness'), resolve(root, '../dsh-wt-02')]
const target = candidates.find(value => value !== undefined && valid(value))
if (target === undefined) {
  throw new Error('dsh-mobile: set DSH_UPSTREAM to a DSH >=0.1.2 checkout containing ' + required)
}
if (existing === target) process.exit(0)
if (existsSync(link)) {
  const stat = lstatSync(link)
  if (!stat.isSymbolicLink()) throw new Error('dsh-mobile: .dsh-upstream exists and is not a symlink')
  rmSync(link)
}
symlinkSync(target, link, 'dir')
console.log('dsh-mobile: .dsh-upstream -> ' + target)
