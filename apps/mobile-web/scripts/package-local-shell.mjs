import { existsSync } from 'node:fs'
import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const preferred = resolve(appRoot, '../../../dsh-wt-02')
const upstream = process.env.DSH_UPSTREAM ?? (existsSync(preferred) ? preferred : resolve(appRoot, '../../../deepseek-harness'))
const layoutSource = resolve(appRoot, '../../packages/ui-layout-mobile/lib/client.js')
const layoutTarget = resolve(appRoot, 'dist/plugins/@dsh-mobile/ui-layout-mobile/client.js')
const hydrationSource = resolve(appRoot, '../../packages/session-hydration-mobile/lib/client.js')
const hydrationTarget = resolve(appRoot, 'dist/plugins/@dsh-mobile/session-hydration/client.js')
const runtimeSource = resolve(upstream, 'packages/client/runtime/lib/client.js')
const runtimeTarget = resolve(appRoot, 'dist/plugins/@dsh-mobile/session-hydration/runtime.js')
const connectionSource = resolve(upstream, 'packages/client/connection/lib/client.js')
const connectionTarget = resolve(appRoot, 'dist/plugins/@dsh-mobile/ui-layout-mobile/connection.js')
await mkdir(dirname(layoutTarget), { recursive: true })
await mkdir(dirname(hydrationTarget), { recursive: true })
await copyFile(layoutSource, layoutTarget)
await copyFile(connectionSource, connectionTarget)
await copyFile(hydrationSource, hydrationTarget)
await copyFile(runtimeSource, runtimeTarget)
console.log('packaged local mobile layout:', layoutTarget)
console.log('packaged local Host bridge connection:', connectionTarget)
console.log('packaged optional hydration provider:', hydrationTarget)
console.log('packaged version-pinned downstream runtime:', runtimeTarget)
