import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const artifacts = [
  ['ui-layout-mobile/client.js', 'mobile layout'],
  ['ui-layout-mobile/connection.js', 'Host bridge connection'],
  ['session-hydration/client.js', 'session hydration provider'],
  ['session-hydration/runtime.js', 'verified enhancement Runtime'],
]

for (const [relativePath, label] of artifacts) {
  const source = resolve(appRoot, 'dist/plugins/@dsh-mobile', relativePath)
  const target = resolve(appRoot, 'android/app/src/main/assets/public/plugins/@dsh-mobile', relativePath)
  await mkdir(dirname(target), { recursive: true })
  await copyFile(source, target)
  console.log('packaged Android ' + label + ':', target)
}
