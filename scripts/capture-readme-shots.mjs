import { mkdir, copyFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { build } from 'vite'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../apps/mobile-web/test/fixtures/readme-shots')
const shots = resolve(dirname(fileURLToPath(import.meta.url)), '../docs/screenshots')
const chrome = process.env.CHROME_BIN ?? '/usr/bin/google-chrome'
const scenes = ['session', 'drawer', 'codex', 'pair', 'first-run', 'connect']

function serve(dir) {
  return new Promise((resolveListen) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      let file = url.pathname === '/' ? '/index.html' : url.pathname
      try {
        const body = await readFile(join(dir, file))
        const type = file.endsWith('.js') ? 'text/javascript'
          : file.endsWith('.css') ? 'text/css'
            : file.endsWith('.svg') ? 'image/svg+xml'
              : 'text/html'
        res.writeHead(200, { 'content-type': type })
        res.end(body)
      } catch {
        res.writeHead(404)
        res.end()
      }
    })
    server.listen(0, '127.0.0.1', () => resolveListen(server))
  })
}

function capture(url, dest) {
  const result = spawnSync(chrome, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
    '--force-device-scale-factor=2', '--window-size=390,844',
    `--screenshot=${dest}`, url,
  ], { encoding: 'utf8', timeout: 25_000 })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'chrome failed')
}

const outDir = await mkdtemp(join(tmpdir(), 'dsh-mobile-readme-'))
await build({ root, base: './', publicDir: join(root, 'public'), configFile: false, logLevel: 'error', build: { outDir, emptyOutDir: true } })
await mkdir(shots, { recursive: true })
const server = await serve(outDir)
const port = server.address().port
try {
  capture(`http://127.0.0.1:${port}/index.html?scene=session`, join(shots, '02-session.png'))
  capture(`http://127.0.0.1:${port}/index.html?scene=drawer`, join(shots, '03-nav-drawer.png'))
  capture(`http://127.0.0.1:${port}/index.html?scene=codex`, join(shots, '04-codex-drawer.png'))
  capture(`http://127.0.0.1:${port}/index.html?scene=pair`, join(shots, '05-pair-qr.png'))
  capture(`http://127.0.0.1:${port}/index.html?scene=first-run`, join(shots, '06-first-run.png'))
  capture(`http://127.0.0.1:${port}/index.html?scene=connect`, join(shots, '07-connect-path.png'))
} finally {
  server.close()
}

const officialRaw = process.env.DSH_MOBILE_OFFICIAL_SHOT
if (officialRaw) {
  await copyFile(officialRaw, join(shots, '_official-narrow-empty.png'))
}
console.log('captured', scenes.join(', '))
