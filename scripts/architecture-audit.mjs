import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import process from 'node:process'

const root = new URL('..', import.meta.url).pathname
const roots = ['apps/mobile-web/src', 'packages/e2e-tunnel/src', 'packages/interaction-operations/src', 'packages/ui-layout-mobile/src', 'plugins/pairing/src']
const sourceExts = new Set(['.ts', '.tsx', '.js', '.mjs', '.json'])
const forbidden = [
  // Official Relay hosts are product infrastructure; personal Host endpoints remain forbidden.
  { name: 'maintainer-owned runtime endpoint', pattern: /(?<!relay(?:-overseas)?\.)noirbright\.top/i },
  { name: 'runtime CDN', pattern: /(?:unpkg\.com|cdn\.jsdelivr\.net|esm\.sh)/i },
  { name: 'TURN URL', pattern: /["']turns?:/i },
  { name: 'browser shell path', pattern: /browserShellPath/ },
  { name: 'browser-shell package', pattern: /browser-shell|package-browser-shell/ },
  { name: 'full document reload', pattern: /location\.reload\(/ },
]
const hostUiRoots = ['packages/interaction-operations/src', 'packages/ui-layout-mobile/src', 'plugins/pairing/src/client']
const hostUiForbidden = [
  { name: 'native Capacitor bridge', pattern: /@capacitor\// },
  { name: 'credential vault', pattern: /credential-vault|DshSecureVault/ },
  { name: 'camera / pairing scanner', pattern: /pairing-scanner|DshCameraPermission|barcode-scanner/ },
]

async function filesUnder(path) {
  const entries = await readdir(path, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const child = join(path, entry.name)
    if (entry.isDirectory()) return filesUnder(child)
    return sourceExts.has(extname(entry.name)) ? [child] : []
  }))
  return nested.flat()
}

const violations = []
for (const base of roots) {
  for (const file of await filesUnder(join(root, base))) {
    const source = await readFile(file, 'utf8')
    for (const rule of forbidden) {
      if (rule.pattern.test(source)) violations.push(`${relative(root, file)}: ${rule.name}`)
    }
  }
}
for (const base of hostUiRoots) {
  for (const file of await filesUnder(join(root, base))) {
    const source = await readFile(file, 'utf8')
    for (const rule of hostUiForbidden) {
      if (rule.pattern.test(source)) violations.push(`${relative(root, file)}: ${rule.name}`)
    }
  }
}
if (violations.length > 0) {
  console.error(violations.join('\n'))
  process.exitCode = 1
} else {
  console.log('architecture audit passed')
}
