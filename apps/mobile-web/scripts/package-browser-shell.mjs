import { cp, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(appRoot, 'dist')
const dest = process.env.DSH_MOBILE_BROWSER_SHELL
  ?? (process.env.DSH_HOME ? resolve(process.env.DSH_HOME, 'mobile', 'browser-shell') : '')

if (dest === '') {
  console.log('skip browser-shell install: set DSH_HOME or DSH_MOBILE_BROWSER_SHELL')
  process.exit(0)
}
if (!existsSync(resolve(dist, 'index.html'))) {
  throw new Error('package-browser-shell: apps/mobile-web/dist/index.html is missing; run vite build first')
}
await mkdir(dest, { recursive: true })
await cp(dist, dest, { recursive: true })
console.log('installed browser shell:', dest)
