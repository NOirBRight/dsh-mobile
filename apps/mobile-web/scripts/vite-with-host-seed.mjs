import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

// prepare-upstream stays on 0.1.2 for types. Host 0.1.5 sidebar-right requires
// dockkit in PLATFORM_MODULES, so Vite may seed from a 0.1.5 src tree without
// retargeting the compile pin.
const candidates = [
  process.env.DSH_HOST_SEED_UPSTREAM,
  resolve(homedir(), '.local/opt/dsh-staging/dsh-v0.1.5-rc.1-183f08e9c6dd-src'),
]
const seed = candidates.find(path => (
  path !== undefined && existsSync(resolve(path, 'packages/client/ui-dockkit/src/index.ts'))
))
const env = { ...process.env }
if (seed !== undefined) env.DSH_UPSTREAM = seed
const result = spawnSync('npx', ['vite', 'build'], {
  stdio: 'inherit',
  env,
  cwd: resolve(import.meta.dirname, '..'),
})
process.exit(result.status === null ? 1 : result.status)
