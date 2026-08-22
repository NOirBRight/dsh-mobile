import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const officialRoot = process.env.DSH_UPSTREAM ?? resolve(appRoot, '../../../deepseek-harness')
const enhancementRoot = process.env.DSH_ENHANCEMENT_RUNTIME ?? resolve(appRoot, '../../../dsh-wt-02')
const metadata = JSON.parse(await readFile(resolve(appRoot, '../../patches/dsh-runtime-session-hydration.json'), 'utf8'))
const layoutSource = resolve(appRoot, '../../packages/ui-layout-mobile/lib/client.js')
const layoutTarget = resolve(appRoot, 'dist/plugins/@dsh-mobile/ui-layout-mobile/client.js')
const hydrationSource = resolve(appRoot, '../../packages/session-hydration-mobile/lib/client.js')
const hydrationTarget = resolve(appRoot, 'dist/plugins/@dsh-mobile/session-hydration/client.js')
const runtimeSource = resolve(enhancementRoot, 'packages/client/runtime/lib/client.js')
const runtimeTarget = resolve(appRoot, 'dist/plugins/@dsh-mobile/session-hydration/runtime.js')
const connectionSource = resolve(officialRoot, 'packages/client/connection/lib/client.js')
const connectionTarget = resolve(appRoot, 'dist/plugins/@dsh-mobile/ui-layout-mobile/connection.js')

const runtime = await readFile(runtimeSource)
const runtimeRevision = createHash('sha1').update(runtime).digest('hex').slice(0, 12)
if (runtimeRevision !== metadata.downstream.runtimeRevision) {
  throw new Error(
    'refusing to package unverified enhancement runtime ' + runtimeRevision
    + '; expected ' + metadata.downstream.runtimeRevision
    + ' from ' + enhancementRoot,
  )
}

await mkdir(dirname(layoutTarget), { recursive: true })
await mkdir(dirname(hydrationTarget), { recursive: true })
await copyFile(layoutSource, layoutTarget)
await copyFile(connectionSource, connectionTarget)
await copyFile(hydrationSource, hydrationTarget)
await copyFile(runtimeSource, runtimeTarget)
console.log('packaged local mobile layout:', layoutTarget)
console.log('packaged official Host bridge connection:', connectionTarget)
console.log('packaged optional hydration provider:', hydrationTarget)
console.log('packaged verified downstream runtime ' + runtimeRevision + ':', runtimeTarget)
