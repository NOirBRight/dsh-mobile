import { copyFile, mkdir, readdir, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * The APK serves its own bundles from mobile-plugins/, beside the web root's
 * plugins/ directory: Capacitor concatenates every file under plugins/ into one
 * document-start script as Cordova plugin JS, where no shell code has run and
 * window.__ModuleLoader__ does not exist yet. dist keeps the Host-served
 * browser layout's /plugins path, so cap copy has just staged these bundles
 * into the swept directory; this step removes them from there and re-stages
 * them under the base the shell asks for. Run it after every cap copy/sync.
 */
const SHELL_OWNED_ENTRIES = new Set(['@dsh-mobile'])
const ARTIFACTS = [
  ['ui-layout-mobile/client.js', 'mobile layout'],
  ['ui-layout-mobile/connection.js', 'Host bridge connection'],
  ['interaction-operations/client.js', 'interaction operations'],
]

/**
 * Stage the shell's own plugin bundles into an Android web root.
 * @param appRoot - Mobile web app root holding dist/ and android/.
 * @returns Nothing; logs one line per staged artifact.
 */
export async function packageAndroidLayout(appRoot) {
  const androidPublic = resolve(appRoot, 'android/app/src/main/assets/public')
  const packagedBase = resolve(androidPublic, 'mobile-plugins/@dsh-mobile')
  const swept = resolve(androidPublic, 'plugins')

  let staged = []
  try {
    staged = await readdir(swept)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  const foreign = staged.filter(entry => !SHELL_OWNED_ENTRIES.has(entry))
  if (foreign.length > 0) {
    throw new Error('package-android-layout: web root plugins/ holds non-shell entries: ' + foreign.join(', '))
  }
  await rm(swept, { recursive: true, force: true })

  for (const [relativePath, label] of ARTIFACTS) {
    const source = resolve(appRoot, 'dist/plugins/@dsh-mobile', relativePath)
    const target = resolve(packagedBase, relativePath)
    await mkdir(dirname(target), { recursive: true })
    await copyFile(source, target)
    console.log('packaged Android ' + label + ':', target)
  }
  console.log('cleared the Capacitor Cordova sweep path:', swept)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await packageAndroidLayout(resolve(dirname(fileURLToPath(import.meta.url)), '..'))
}
