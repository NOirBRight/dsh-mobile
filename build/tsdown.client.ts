/**
 * Shared tsdown preset for UI plugin client bundles. Adapted copy of
 * deepseek-harness packages/client/tsdown.client.ts — sync target: keep this
 * file diffable against the upstream original. Only two intentional changes:
 * the PLATFORM_MODULES import points at the upstream checkout, and
 * REPOSITORY_ROOT is this repository's root (sourcemap path rebasing).
 *
 * Emits a closure-factory artifact: the bundle calls
 * window.__ModuleLoader__.load({id, factory}) and resolves externals through
 * the injected require (loader module table). CSS Modules are compiled by
 * lightningcss: importing x.module.css yields the hashed class map, and the
 * css text auto-injects a <style data-plugin="<id>"> tag at factory execution.
 */
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, relative, resolve as resolvePath, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { UserConfig } from 'tsdown'
import { transform } from 'lightningcss'
import { PLATFORM_MODULES } from '../../deepseek-harness/packages/client/web/src/platform.ts'

const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

/** Wire/type layers a client bundle may inline (no shared runtime identity). */
export const INLINE_SAFE = /^@deepseek-ai\/dsh-(host-apiproxy|session|llm|tools|brand)(\/|$)/
/** Vendored framework libraries: ordinary libraries a browser bundle inlines. */
const VENDORED_LIBRARY = /^@deepseek-ai\/(cosmokit|schemastery)(\/|$)/
/** Generated descriptor/codec contribution with no shared runtime identity. */
const GENERATED_REMOTE = /^@deepseek-ai\/dsh-[a-z0-9]+(?:-[a-z0-9]+)*\/remote$/
/** Workspace mode replaces an empty config array with the root defaults. */
const SKIP_WORKSPACE_BUILD: UserConfig = { entry: '' }
/**
 * Documented TEMPORARY exemption, not a platform module: the snapshot-store
 * engine (defineStore & friends) lives in runtime pending its rehoming; the
 * lazy CJS table answers the require natively (runtime is immediately-tier).
 */
const RUNTIME_STORE_EXEMPTION = '@deepseek-ai/dsh-client-runtime/client'
/** Externals resolved from the loader module table. */
export const CLIENT_EXTERNALS: readonly string[] = [...PLATFORM_MODULES, RUNTIME_STORE_EXEMPTION]

const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url))

/** Rebase a physical lib-relative source onto a browser URL that mirrors the repository directories. */
function browserSourcePath(source: string, sourcemapPath: string): string {
  if (!source.startsWith('.')) return source
  const physicalSource = resolvePath(dirname(sourcemapPath), source)
  const repositoryPath = relative(REPOSITORY_ROOT, physicalSource).split(sep).join('/')
  return repositoryPath.startsWith('packages/') ? '../../../' + repositoryPath : source
}

/**
 * Build the tsdown config for one UI plugin package: the node-half lib build
 * plus the browser client bundle.
 * @param id - plugin id (package name), stamped into the load handoff and style tags.
 * @param libEntry - node-half entries (lib/types outputs of the tsc pass).
 * @param options - phase placement, lib overrides, and companion Node configs.
 * @returns ENV-selected tsdown config for the current build face.
 */
export function clientBundle(
  id: string,
  libEntry: readonly string[],
  options: ClientBundleOptions = {},
): BuildFaceConfig {
  const lib = clientLibraryConfig(id, libEntry, options.lib)
  return ({ env }) => {
    const face = buildFace(env?.DSH_BUILD_FACE)
    const client = clientConfig(id, face === undefined
      ? 'src/client/index.ts'
      : 'lib/types/client/index.js')
    const node = [lib, ...(options.companions ?? [])]
    if (face === 'host') return options.hostPhase === true ? node : [SKIP_WORKSPACE_BUILD]
    if (face === 'client') return options.hostPhase === true ? [client] : [...node, client]
    return [...node, client]
  }
}

/** Build a Client-only Node library during the Client pass. */
export function clientLibrary(id: string, libEntry: readonly string[]): BuildFaceConfig {
  const lib = clientLibraryConfig(id, libEntry)
  return clientOnly([lib])
}

/** Select arbitrary package-local configs only during the Client pass. */
export function clientOnly(configs: readonly UserConfig[]): BuildFaceConfig {
  return ({ env }) => buildFace(env?.DSH_BUILD_FACE) === 'host'
    ? [SKIP_WORKSPACE_BUILD]
    : [...configs]
}

interface ClientBundleOptions {
  /** Emit the Node-side artifacts during the Host pass instead of the Client pass. */
  readonly hostPhase?: boolean
  /** Additional Node-side configs emitted alongside the package library. */
  readonly companions?: readonly UserConfig[]
  /** Overrides for the package's primary Node-side library config. */
  readonly lib?: UserConfig
}

type BuildFace = 'host' | 'client' | undefined

type BuildFaceConfig = (inlineConfig: Pick<UserConfig, 'env'>) => UserConfig[]

function buildFace(value: unknown): BuildFace {
  if (value === undefined || value === 'host' || value === 'client') return value
  throw new Error('tsdown: --env.DSH_BUILD_FACE must be host or client, received ' + String(value))
}

function clientLibraryConfig(
  id: string,
  libEntry: readonly string[],
  overrides: UserConfig = {},
): UserConfig {
  return {
    name: id,
    entry: [...libEntry],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    ...overrides,
  }
}

function clientConfig(id: string, entry: string): UserConfig {
  return {
    name: id + '/client',
    entry: { client: entry },
    // Browser bundle lands next to the node half; clean must stay off.
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    sourcemap: true,
    clean: false,
    external: [...CLIENT_EXTERNALS],
    // The module table answers exactly CLIENT_EXTERNALS; bundle everything else.
    noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    plugins: [{
      // Bundle purity gate: platform seed entries stay external; every other
      // @deepseek-ai value import is a build error (type-only imports erase).
      name: 'dsh-client-bundle-purity',
      resolveId(source: string) {
        if (!source.startsWith('@deepseek-ai/')) return null
        if (CLIENT_EXTERNALS.includes(source)) return null
        if (VENDORED_LIBRARY.test(source)) return null
        if (INLINE_SAFE.test(source) || GENERATED_REMOTE.test(source)) return null
        throw new Error(
          'client bundle purity: "' + source + '" is not a platform module (CLIENT_EXTERNALS), an inline-safe wire layer, or a generated /remote contribution — '
          + 'cross-plugin value imports are forbidden; collaborate through cordis services',
        )
      },
    }, {
      name: 'dsh-css-modules-inline',
      resolveId(source: string, importer: string | undefined) {
        if (!source.endsWith('.module.css')) return null
        const abs = importer !== undefined ? sourceAssetPath(source, importer) : resolvePath(source)
        const stableId = relative(REPOSITORY_ROOT, abs).split(sep).join('/')
        return CSS_VIRTUAL_PREFIX + stableId + CSS_VIRTUAL_SUFFIX
      },
      async load(virtualId: string) {
        if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
        const stableId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
        const fileId = resolvePath(REPOSITORY_ROOT, stableId)
        this.addWatchFile(fileId)
        const source = await readFile(fileId)
        const { code, exports: cssExports } = transform({
          filename: fileId,
          code: source,
          cssModules: { pattern: '[hash]_[local]' },
          minify: true,
        })
        const classMap: Record<string, string> = {}
        for (const [local, exp] of Object.entries(cssExports ?? {})) classMap[local] = exp.name
        return [
          'const css = ' + JSON.stringify(code.toString()) + ';',
          'const tagId = ' + JSON.stringify(id + '/' + basename(fileId)) + ';',
          "if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {",
          "  const tag = document.createElement('style');",
          '  tag.dataset.plugin = ' + JSON.stringify(id) + ';',
          '  tag.dataset.pluginCss = tagId;',
          '  tag.textContent = css;',
          '  document.head.appendChild(tag);',
          '}',
          'export default ' + JSON.stringify(classMap) + ';',
        ].join('\n')
      },
    }],
    outputOptions: {
      entryFileNames: 'client.js',
      sourcemapPathTransform: browserSourcePath,
      banner: 'window.__ModuleLoader__.load({ id: ' + JSON.stringify(id) + ', factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  }
}

/** Resolve an emitted JS asset import against its source-tree counterpart. */
function sourceAssetPath(source: string, importer: string): string {
  const emitted = resolvePath(dirname(importer), source)
  if (existsSync(emitted)) return emitted
  const marker = sep + 'lib' + sep + 'types' + sep
  const boundary = emitted.indexOf(marker)
  if (boundary < 0) return emitted
  return resolvePath(emitted.slice(0, boundary), 'src', emitted.slice(boundary + marker.length))
}
