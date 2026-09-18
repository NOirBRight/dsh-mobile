import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

function firstExisting(candidates, file) {
  return candidates.find(path => path !== undefined && existsSync(resolve(path, file)))
}

const staging = resolve(homedir(), '.local/opt/dsh-staging')
// prepare-upstream stays on 0.1.2 for types. The 0.1.5 src tree has nested
// node_modules Vite needs for dockkit/cordis; do not retarget that compile pin.
const seed = firstExisting([
  process.env.DSH_HOST_SEED_UPSTREAM,
  resolve(staging, 'dsh-v0.1.5-rc.1-183f08e9c6dd-src'),
], 'packages/client/ui-dockkit/src/index.ts')
// 0.1.6-alpha.2 conversation calls SlotCore.registerFactory. Seeding the 0.1.5
// SlotCore leaves Host renderer wrapping a core without that method.
const slots = firstExisting([
  process.env.DSH_SLOTS_SEED,
  resolve(staging, 'dsh-v0.1.6-alpha.2-src'),
], 'packages/client/ui-slots/src/index.ts')
const env = { ...process.env }
if (seed !== undefined) env.DSH_UPSTREAM = seed
if (slots !== undefined) env.DSH_SLOTS_SEED = slots
const result = spawnSync('npx', ['vite', 'build'], {
  stdio: 'inherit',
  env,
  cwd: resolve(import.meta.dirname, '..'),
})
process.exit(result.status === null ? 1 : result.status)
