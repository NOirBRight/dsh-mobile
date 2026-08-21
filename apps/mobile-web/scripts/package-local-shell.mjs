import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const upstream = process.env.DSH_UPSTREAM ?? resolve(appRoot, '../../../deepseek-harness')
const layoutSource = resolve(appRoot, '../../packages/ui-layout-mobile/lib/client.js')
const layoutTarget = resolve(appRoot, 'dist/plugins/@dsh-mobile/ui-layout-mobile/client.js')
const connectionSource = resolve(upstream, 'packages/client/connection/lib/client.js')
const connectionTarget = resolve(appRoot, 'dist/plugins/@dsh-mobile/ui-layout-mobile/connection.js')
await mkdir(dirname(layoutTarget), { recursive: true })
await copyFile(layoutSource, layoutTarget)
await copyFile(connectionSource, connectionTarget)
console.log('packaged local mobile layout:', layoutTarget)
console.log('packaged local Host bridge connection:', connectionTarget)
