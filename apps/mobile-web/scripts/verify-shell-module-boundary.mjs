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
console.log('shell module boundary passed:', match[1])
