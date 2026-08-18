import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(appRoot, '../../packages/ui-layout-mobile/lib/client.js')
const target = resolve(appRoot, 'dist/plugins/@dsh-mobile/ui-layout-mobile/client.js')
await mkdir(dirname(target), { recursive: true })
await copyFile(source, target)
console.log('packaged local mobile layout:', target)
