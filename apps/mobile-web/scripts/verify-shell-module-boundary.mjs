import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = fileURLToPath(new URL('..', import.meta.url))
const dist = resolve(appRoot, 'dist')
const html = await readFile(resolve(dist, 'index.html'), 'utf8')
const match = /<script[^>]+src=["']\/?(assets\/[^"']+\.js)["']/.exec(html)
if (match === null) throw new Error('shell boundary: dist/index.html has no main module script')
const main = await readFile(resolve(dist, match[1]), 'utf8')

// This package is a Host graph plugin in the deployed rc.8 roster. Seeding a
// static atoms object under the same id makes the loader apply that object
// instead of the fetched plugin ({ apply }), producing the PC boot failure.
const forbiddenStaticIds = ['@deepseek-ai/dsh-client-ui-attachment']
for (const id of forbiddenStaticIds) {
  if (main.includes(id)) {
    throw new Error(
      'shell boundary: main bundle statically contains dynamic Host plugin ' + id
      + '; build with the Host-compatible DSH_UPSTREAM',
    )
  }
}
// Host plugin bundles resolve their require against exactly this word list, so
// a shell built from an older checkout fails at runtime with
// "require(...) missed the module table" for every word it never learned.
const upstream = process.env.DSH_UPSTREAM ?? resolve(appRoot, '../../.dsh-upstream')
const platform = await readFile(resolve(upstream, 'packages/client/web/src/platform.ts'), 'utf8')
const block = /PLATFORM_MODULES = \[([\s\S]*?)\] as const/.exec(platform)
if (block === null) throw new Error('shell boundary: cannot read PLATFORM_MODULES from ' + upstream)
const words = [...block[1].matchAll(/'([^']+)'/gu)].map(entry => entry[1])
if (words.length === 0) throw new Error('shell boundary: PLATFORM_MODULES is empty in ' + upstream)
// The seed table is one object literal emitted in PLATFORM_MODULES order, so the
// words must appear in that order inside a short span — scattered mentions
// elsewhere in the bundle do not seed anything.
let cursor = -1
let last = -1
for (const word of words) {
  const at = main.indexOf(word, cursor + 1)
  if (at < 0) {
    throw new Error(
      'shell boundary: main bundle does not seed platform module ' + word
      + '; build with the Host-compatible DSH_UPSTREAM',
    )
  }
  cursor = at
  last = at
}
// Anchor the span on the first platform word that only the table carries.
const seedSpan = main.indexOf('react/jsx-runtime')
if (seedSpan < 0 || last - seedSpan > 1000) {
  throw new Error('shell boundary: platform modules are not seeded from one module table in ' + upstream)
}
console.log('shell platform modules seeded (' + words.length + '):', words.join(', '))
console.log('shell module boundary passed:', match[1])
