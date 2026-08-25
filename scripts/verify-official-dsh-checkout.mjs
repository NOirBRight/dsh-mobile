import { execFileSync } from 'node:child_process'
import process from 'node:process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const OFFICIAL_REPOSITORY = 'deepseek-ai/deepseek-harness'
export const REQUIRED_DSH_REVISION = 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'

function repositoryOf(remote) {
  return remote
    .trim()
    .replace(/^git@github\.com:/, '')
    .replace(/^ssh:\/\/git@github\.com\//, '')
    .replace(/^https?:\/\/github\.com\//, '')
    .replace(/\.git$/, '')
}

export function assessOfficialDshCheckout({ remote, status, head, expectedRevision = REQUIRED_DSH_REVISION }) {
  const reasons = []
  if (repositoryOf(remote) !== OFFICIAL_REPOSITORY) {
    reasons.push('origin is not deepseek-ai/deepseek-harness')
  }
  if (status.trim() !== '') {
    reasons.push('official DSH checkout has local changes')
  }
  if (head.trim() !== expectedRevision) {
    reasons.push('official DSH revision does not match the required baseline')
  }
  return reasons.length === 0
    ? { ok: true, revision: head.trim() }
    : { ok: false, reasons }
}

function git(checkout, ...args) {
  return execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8', timeout: 10_000 }).trim()
}

export function inspectOfficialDshCheckout(checkout, expectedRevision) {
  return assessOfficialDshCheckout({
    remote: git(checkout, 'config', '--get', 'remote.origin.url'),
    status: git(checkout, 'status', '--porcelain'),
    head: git(checkout, 'rev-parse', 'HEAD'),
    ...(expectedRevision === undefined ? {} : { expectedRevision }),
  })
}

function main() {
  const scriptDir = dirname(fileURLToPath(import.meta.url))
  const checkout = process.env.DSH_UPSTREAM ?? resolve(scriptDir, '..', '..', 'deepseek-harness')
  const result = inspectOfficialDshCheckout(checkout, process.env.DSH_EXPECTED_REVISION)
  if (!result.ok) {
    console.error(result.reasons.map(reason => checkout + ': ' + reason).join('\n'))
    process.exitCode = 1
    return
  }
  console.log(JSON.stringify({ checkout, cleanOfficialDsh: true, revision: result.revision }, null, 2))
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main()
