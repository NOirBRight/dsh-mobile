import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const officialRoot = process.env.DSH_UPSTREAM ?? resolve(appRoot, '../../.dsh-upstream')
const layoutSource = resolve(appRoot, '../../packages/ui-layout-mobile/lib/client.js')
const layoutTarget = resolve(appRoot, 'dist/plugins/@dsh-mobile/ui-layout-mobile/client.js')
const interactionsSource = resolve(appRoot, '../../packages/interaction-operations/lib/client.js')
const interactionsTarget = resolve(appRoot, 'dist/plugins/@dsh-mobile/interaction-operations/client.js')
const connectionSource = resolve(officialRoot, 'packages/client/connection/lib/client.js')
const connectionTarget = resolve(appRoot, 'dist/plugins/@dsh-mobile/ui-layout-mobile/connection.js')

await mkdir(dirname(layoutTarget), { recursive: true })
await mkdir(dirname(interactionsTarget), { recursive: true })
await copyFile(layoutSource, layoutTarget)
await copyFile(interactionsSource, interactionsTarget)
await copyFile(connectionSource, connectionTarget)
console.log('packaged local mobile layout:', layoutTarget)
console.log('packaged interaction operations:', interactionsTarget)
console.log('packaged official Host bridge connection:', connectionTarget)
