import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const layoutSource = resolve(appRoot, 'dist/plugins/@dsh-mobile/ui-layout-mobile/client.js')
const layoutTarget = resolve(appRoot, 'android/app/src/main/assets/public/plugins/@dsh-mobile/ui-layout-mobile/client.js')
const connectionSource = resolve(appRoot, 'dist/plugins/@dsh-mobile/ui-layout-mobile/connection.js')
const connectionTarget = resolve(appRoot, 'android/app/src/main/assets/public/plugins/@dsh-mobile/ui-layout-mobile/connection.js')
await mkdir(dirname(layoutTarget), { recursive: true })
await copyFile(layoutSource, layoutTarget)
await copyFile(connectionSource, connectionTarget)
console.log('packaged Android mobile layout:', layoutTarget)
console.log('packaged Android Host bridge connection:', connectionTarget)
