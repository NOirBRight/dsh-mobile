import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const testRoot = dirname(fileURLToPath(import.meta.url))

/**
 * Production contract: every runtime Host import must exist in the published
 * e2e-tunnel package that the pairing dependency resolves to. Set
 * DSH_E2E_TUNNEL_MODULE to an explicit published-tag build to audit a tag
 * instead of the checkout's normal node_modules resolution.
 */
test('pairing Host imports are a subset of the published e2e-tunnel exports', async () => {
  const modulePath = process.env.DSH_E2E_TUNNEL_MODULE
    ? resolve(process.env.DSH_E2E_TUNNEL_MODULE)
    : require.resolve('@dsh-mobile/e2e-tunnel')
  const tunnelSource = await readFile(modulePath, 'utf8')
  const tunnelExports = new Set()
  for (const match of tunnelSource.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const specifier of match[1].split(',')) {
      const name = specifier.trim().split(/\s+as\s+/)[0]
      if (name !== '') tunnelExports.add(name)
    }
  }
  const libRoot = process.env.DSH_PAIRING_LIB_ROOT
    ? resolve(process.env.DSH_PAIRING_LIB_ROOT)
    : resolve(testRoot, '../lib')
  const files = (await readdir(libRoot)).filter(file => file.endsWith('.js'))
  const imports = new Set()
  const importPattern = /import\s*\{([^}]*)\}\s*from\s*['"]@dsh-mobile\/e2e-tunnel['"]/g
  for (const file of files) {
    const source = await readFile(resolve(libRoot, file), 'utf8')
    for (const match of source.matchAll(importPattern)) {
      for (const specifier of match[1].split(',')) {
        const name = specifier.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]
        if (name !== '') imports.add(name)
      }
    }
  }
  const missing = [...imports].filter(name => !tunnelExports.has(name)).sort()
  assert.deepEqual(missing, [], 'published e2e-tunnel is missing Host imports: ' + missing.join(', '))
})
