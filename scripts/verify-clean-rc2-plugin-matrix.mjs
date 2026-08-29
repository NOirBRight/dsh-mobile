import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { inspectOfficialDshCheckout, REQUIRED_DSH_REVISION } from './verify-official-dsh-checkout.mjs'

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workstation = resolve(project, '..')
const checkout = resolve(process.env.DSH_UPSTREAM ?? resolve(project, '.dsh-upstream'))
const composerRoot = resolve(process.env.COMPOSER_PICKER_ROOT ?? resolve(workstation, 'dsh-composer-picker'))
const externalRoot = resolve(process.env.EXTERNAL_AGENTS_ROOT ?? resolve(workstation, 'dsh-external-agents'))
const pairingRoot = resolve(process.env.MOBILE_PAIRING_ROOT ?? resolve(workstation, 'dsh-mobile-pairing'))
const interactionRoot = resolve(project, 'packages/interaction-operations')
const layoutRoot = resolve(project, 'packages/ui-layout-mobile')
const cli = resolve(checkout, 'apps/cli/lib/bin.js')
const commandTimeoutMs = 600_000
const bootTimeoutMs = 120_000
const requestTimeoutMs = 10_000
const shutdownTimeoutMs = 5_000

function run(file, args, options = {}) {
  return execFileSync(file, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: commandTimeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  })
}

function assertPublishableManifest(manifest, label) {
  const exported = JSON.stringify(manifest.exports ?? {})
  if (exported.includes('/src/')) throw new Error(label + ' exports unpacked source paths')
  const dependencies = {
    ...manifest.dependencies,
    ...manifest.optionalDependencies,
    ...manifest.peerDependencies,
  }
  for (const [name, value] of Object.entries(dependencies)) {
    if (name === 'deepseek-harness' || name === '@deepseek-ai/deepseek-harness') {
      throw new Error(label + ' depends on a vendored DSH checkout')
    }
    if (typeof value === 'string' && /^(?:file|link|workspace):/u.test(value)) {
      throw new Error(label + ' contains a source-checkout dependency alias: ' + value)
    }
  }
}

function inspectPackedArtifact(packagePath) {
  const entries = run('tar', ['-tzf', packagePath]).trim().split('\n').filter(Boolean)
  for (const entry of entries) {
    const path = entry.replace(/^package\//u, '')
    if (/(?:^|\/)(?:src|tests|node_modules)(?:\/|$)/u.test(path)
      || /(?:^|\/)@deepseek-ai\//u.test(path)
      || /\.map$/u.test(path)
      || /\.(?:diff|patch)$/iu.test(path)) {
      throw new Error(packagePath + ' contains forbidden packed path ' + path)
    }
  }
  for (const required of ['package/package.json', 'package/cordis.patch.yml', 'package/lib/index.js', 'package/lib/client.js']) {
    if (!entries.includes(required)) throw new Error(packagePath + ' is missing ' + required.replace(/^package\//u, ''))
  }
  const manifest = JSON.parse(run('tar', ['-xOf', packagePath, 'package/package.json']))
  assertPublishableManifest(manifest, packagePath + ':package.json')
  const regularEntries = entries.filter(entry => !entry.endsWith('/'))
  const packedText = regularEntries.map(entry => run('tar', ['-xOf', packagePath, entry])).join('\n')
  if (/(?:\/home\/[^/]+\/(?:Workstation|src)\/|[A-Z]:\\[^\n]+\\src\\)/u.test(packedText)) {
    throw new Error(packagePath + ' contains an absolute source-checkout alias')
  }
  const documentationEntries = regularEntries.filter(entry => /(?:\.md|\.txt)$/iu.test(entry))
  const documentation = documentationEntries.map(entry => run('tar', ['-xOf', packagePath, entry])).join('\n')
  if (/(?:file|link|workspace):/u.test(documentation)) {
    throw new Error(packagePath + ' documents a source-checkout alias')
  }
  const runtimeEntries = regularEntries.filter(entry => /\.(?:js|d\.ts|json|ya?ml)$/u.test(entry) && !entry.endsWith('package.json'))
  const runtime = runtimeEntries.map(entry => run('tar', ['-xOf', packagePath, entry])).join('\n')
  for (const forbidden of [
    'EXTERNAL_PLAN_HANDOFF_SENTINEL',
    'conversation.composer.plan-review.execution-model',
    'setApprovalPreparation',
    'PlanReviewExecutionModelAdapter',
  ]) {
    if (runtime.includes(forbidden)) throw new Error(packagePath + ' contains fork-only contract ' + forbidden)
  }
}

function pack(root, destination) {
  const sourceManifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
  assertPublishableManifest(sourceManifest, resolve(root, 'package.json'))
  const output = run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', destination], { cwd: root })
  const report = JSON.parse(output.slice(output.lastIndexOf('\n[') + 1))[0]
  if (report?.filename === undefined) throw new Error('npm pack returned no filename for ' + root)
  const packagePath = resolve(destination, basename(report.filename))
  inspectPackedArtifact(packagePath)
  return packagePath
}

function occurrences(text, needle) {
  return text.split(needle).length - 1
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)
  return new Promise((resolveExit) => {
    const onExit = () => {
      clearTimeout(timer)
      resolveExit(true)
    }
    const timer = setTimeout(() => {
      child.off('exit', onExit)
      resolveExit(false)
    }, timeoutMs)
    child.once('exit', onExit)
  })
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  if (await waitForExit(child, shutdownTimeoutMs)) return
  child.kill('SIGKILL')
  if (!await waitForExit(child, shutdownTimeoutMs)) {
    throw new Error('DSH profile process did not stop after SIGKILL')
  }
}

async function fetchText(url, label, cookie) {
  const response = await fetch(url, {
    headers: cookie === undefined ? {} : { cookie },
    signal: AbortSignal.timeout(requestTimeoutMs),
  })
  if (!response.ok) throw new Error(label + ' returned HTTP ' + String(response.status))
  return response.text()
}

async function bootProfile({ name, packages, expectedEntries, bundleAssertions, root }) {
  const home = resolve(root, name)
  for (const packagePath of packages) {
    run(process.execPath, [cli, 'plugin', '--profile', 'web', 'add', packagePath], {
      env: { ...process.env, DSH_HOME: home },
    })
  }

  const child = spawn(process.execPath, [cli, 'web', '--no-open', '--port', '0'], {
    env: { ...process.env, DSH_HOME: home },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', chunk => { stderr += chunk })

  try {
    const url = await new Promise((resolveUrl, reject) => {
      let stdout = ''
      const timer = setTimeout(() => reject(new Error(name + ' boot timed out\n' + stderr)), bootTimeoutMs)
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', chunk => {
        stdout += chunk
        const match = stdout.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s)]+)/u)
        if (match?.[1] !== undefined) {
          clearTimeout(timer)
          resolveUrl(match[1])
        }
      })
      child.once('exit', code => {
        clearTimeout(timer)
        reject(new Error(name + ' exited before serving (code ' + String(code) + ')\n' + stderr))
      })
    })

    const login = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(requestTimeoutMs),
    })
    if (login.status !== 303) throw new Error(name + ' token exchange returned HTTP ' + String(login.status))
    const setCookie = login.headers.get('set-cookie')
    if (setCookie === null) throw new Error(name + ' token exchange returned no browser-session cookie')
    const cookie = setCookie.split(';', 1)[0]
    const origin = new URL(url).origin
    const html = await fetchText(origin + '/', name + ' root', cookie)
    for (const entry of expectedEntries) {
      if (occurrences(html, '\"id\":\"' + entry + '\"') !== 1) {
        throw new Error(name + ' expected exactly one boot entry for ' + entry)
      }
      const idAt = html.indexOf('"id":"' + entry + '"')
      const urlMarker = '"url":"'
      const urlAt = html.indexOf(urlMarker, idAt)
      const urlEnd = urlAt < 0 ? -1 : html.indexOf('"', urlAt + urlMarker.length)
      if (idAt < 0 || urlAt < 0 || urlEnd < 0) throw new Error(name + ' boot entry has no URL for ' + entry)
      const bundlePath = JSON.parse('"' + html.slice(urlAt + urlMarker.length, urlEnd) + '"')
      const source = await fetchText(new URL(bundlePath, origin).toString(), name + ' bundle for ' + entry, cookie)
      for (const assertion of bundleAssertions[entry] ?? []) assertion(source)
    }
    return { name, entries: expectedEntries }
  } finally {
    await stopChild(child)
  }
}

function includes(needle) {
  return source => {
    if (!source.includes(needle)) throw new Error('served bundle is missing ' + needle)
  }
}

function excludes(needle) {
  return source => {
    if (source.includes(needle)) throw new Error('served bundle contains fork-only contract ' + needle)
  }
}

const expectedRevision = process.env.DSH_EXPECTED_REVISION ?? REQUIRED_DSH_REVISION
const checkoutResult = inspectOfficialDshCheckout(checkout, expectedRevision)
if (!checkoutResult.ok) throw new Error(checkoutResult.reasons.join('; '))
if (!existsSync(cli)) throw new Error('official DSH CLI is not built: ' + cli)

// Keep temporary profiles on the workspace filesystem so pnpm can reuse the verified content store while resolving published dependencies normally.
const root = mkdtempSync(resolve(project, '.dsh-clean-rc2-matrix-'))
try {
  run('pnpm', ['check'], { cwd: composerRoot })
  run('pnpm', ['check'], { cwd: externalRoot })
  run('pnpm', ['compat:check'], {
    cwd: externalRoot,
    env: { ...process.env, DSH_COMPOSER_PICKER_REPO: composerRoot },
  })
  run('npm', ['run', 'typecheck'], { cwd: project })
  run('npm', ['test'], { cwd: project })
  run('npm', ['run', 'audit:architecture'], { cwd: project })
  run('npm', ['run', 'build'], { cwd: project, env: { ...process.env, DSH_UPSTREAM: checkout } })
  run('npm', ['run', 'typecheck'], { cwd: pairingRoot })
  run('npm', ['test'], { cwd: pairingRoot })
  run('npm', ['run', 'build'], { cwd: pairingRoot })

  const packDirectory = resolve(root, 'packs')
  mkdirSync(packDirectory, { recursive: true })
  const composerPackage = pack(composerRoot, packDirectory)
  const externalPackage = pack(externalRoot, packDirectory)
  const pairingPackage = pack(pairingRoot, packDirectory)
  const interactionPackage = pack(interactionRoot, packDirectory)
  const layoutPackage = pack(layoutRoot, packDirectory)
  const commonForbidden = [
    'conversation.composer.plan-review.execution-model',
    'EXTERNAL_PLAN_HANDOFF_SENTINEL',
    'setApprovalPreparation',
    'PlanReviewExecutionModelAdapter',
  ]
  const cleanBundle = commonForbidden.map(excludes)
  const bundleAssertions = {
    'dsh-composer-picker': [
      includes('plan.approve'),
      includes('external-agents.plan-review.continue-in-dsh'),
      ...cleanBundle,
    ],
    'dsh-external-agents': [
      includes('external-agents.plan-review.continue-in-dsh'),
      includes('plan.externalUnavailable'),
      ...cleanBundle,
    ],
    '@dsh-mobile/pairing': cleanBundle,
    '@dsh-mobile/interaction-operations': cleanBundle,
    '@dsh-mobile/ui-layout-mobile': cleanBundle,
  }
  const profiles = []
  profiles.push(await bootProfile({
    name: 'composer-only',
    packages: [composerPackage],
    expectedEntries: ['dsh-composer-picker'],
    bundleAssertions,
    root,
  }))
  profiles.push(await bootProfile({
    name: 'external-only',
    packages: [externalPackage],
    expectedEntries: ['dsh-external-agents'],
    bundleAssertions,
    root,
  }))
  profiles.push(await bootProfile({
    name: 'combined',
    packages: [externalPackage, composerPackage],
    expectedEntries: ['dsh-external-agents', 'dsh-composer-picker'],
    bundleAssertions,
    root,
  }))
  profiles.push(await bootProfile({
    name: 'mobile',
    packages: [pairingPackage, interactionPackage, layoutPackage],
    expectedEntries: [
      '@dsh-mobile/pairing',
      '@dsh-mobile/interaction-operations',
      '@dsh-mobile/ui-layout-mobile',
    ],
    bundleAssertions,
    root,
  }))

  console.log(JSON.stringify({
    cleanOfficialDsh: checkoutResult.revision,
    packedProfiles: profiles,
  }, null, 2))
} finally {
  rmSync(root, { recursive: true, force: true })
}
