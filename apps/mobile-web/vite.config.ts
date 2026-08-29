/**
 * Mobile shell Vite build. Mirrors upstream apps/web/vite.config.ts with one
 * adaptation: the workspace aliases point at the upstream checkout's SOURCES
 * (DSH_UPSTREAM, default: the prepared .dsh-upstream link), because
 * the browser bundle must compile src directly so CSS rides vite's pipeline
 * (package.json exports point at lib for Node consumers). Plugin packages are
 * NEVER bundled here — they arrive as runtime bundles through the client
 * module system (/plugins, host-side scan of the dsh.client roster).
 */
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const src = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url))
/** Upstream checkout root selected by prepare-upstream.mjs; explicit env still wins. */
const preparedUpstream = fileURLToPath(new URL('../../.dsh-upstream', import.meta.url))
const UP = process.env.DSH_UPSTREAM ?? preparedUpstream
const up = (rel: string): string => UP + '/' + rel

const STANDALONE_ERROR = 'apps/mobile-web is an Android shell, not a standalone browser server: bare Vite cannot supply a paired tunnel or window.__DSH_BOOT__. Build/sync the Capacitor app instead.'

/** Fail before a Vite dev or preview server can expose the boot-manifest-free shell. */
function rejectStandaloneServe(): Plugin {
  return {
    name: 'dsh-reject-standalone-web-serve',
    config(_config, env) {
      if (env.command === 'serve') throw new Error(STANDALONE_ERROR)
    },
  }
}

export default defineConfig({
  plugins: [rejectStandaloneServe(), react()],
  build: {
    sourcemap: true,
  },
  resolve: {
    // Subpath aliases must win over bare-name prefixes (order matters).
    alias: [
      // Browserization of the vendored cordis Loader: its only node-only import.
      { find: /^node:module$/, replacement: src('./src/node-module-stub.ts') },
      { find: /^@deepseek-ai\/dsh-client-web$/, replacement: up('packages/client/web/src/index.ts') },
      { find: /^@deepseek-ai\/dsh-client-web-react$/, replacement: up('packages/client/web-react/src/index.ts') },
      { find: /^@deepseek-ai\/dsh-client-ui-slots$/, replacement: up('packages/client/ui-slots/src/index.ts') },
      { find: /^@deepseek-ai\/dsh-client-ui-primitives$/, replacement: up('packages/client/ui-primitives/src/index.ts') },
      { find: /^@deepseek-ai\/dsh-client-ui-attachment$/, replacement: up('packages/client/ui-attachment/src/index.ts') },
      { find: /^@deepseek-ai\/dsh-client-schema-form$/, replacement: up('packages/client/schema-form/src/index.ts') },
      { find: /^@deepseek-ai\/dsh-client-modules\/client$/, replacement: up('packages/client/modules/src/client/index.ts') },
    ],
  },
  define: {
    // Vendored loader internal.ts: "0.0.0" takes neither Node branch (the
    // shell boot fills the empty internal slot with the client module loader).
    'process.versions.node': '"0.0.0"',
    'process.execArgv': '[]',
    // Vendored loader index.ts: envData falls to its default branch.
    'process.env.CORDIS_SHARED': 'undefined',
  },
})
