import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('mobile-web build does not package a browser Product Client shell', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.doesNotMatch(pkg.scripts.build, /package-browser-shell/)
})

test('mobile shell re-evaluates viewport on tunnel and same-origin breakpoint changes', async () => {
  const source = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /const responsiveOptions/)
  assert.match(source, /viewportWidth: readViewportWidth\(\)/)
  assert.match(source, /if \(sameOriginManifest !== null\)/)
  assert.match(source, /void bootDshShell\(selection\)/)
  assert.match(source, /selection\.fallbackOfficial/)
  assert.match(source, /layout-load-failed/)
  assert.match(source, /mobileLayoutFailedRev/)
  assert.match(source, /inspectChromeAnchors\(\)/)
})

test('mobile Vite alias follows the cross-version public web entry', async () => {
  const source = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8')
  assert.match(source, /packages\/client\/web\/src\/index\.ts/)
  assert.doesNotMatch(source, /packages\/client\/web\/src\/boot\.tsx/)
})
