import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const upstream = process.env.DSH_UPSTREAM ?? resolve(appRoot, '../../../deepseek-harness')
const npm = process.env.npm_execpath ?? 'npm'

// The root build:lib:client task type-checks every upstream package before
// invoking tsdown. The mobile shell only needs the browser client bundle; use
// tsdown directly so unrelated upstream exact-optional diagnostics cannot
// prevent a layout-only shell release.
await new Promise((resolvePromise, reject) => {
  const child = spawn(npm, ['exec', 'tsdown', '--', '--env.DSH_BUILD_FACE', 'client'], {
    cwd: upstream,
    stdio: 'inherit',
    shell: npm.endsWith('.cmd'),
  })
  child.once('error', reject)
  child.once('exit', code => {
    if (code === 0) resolvePromise()
    else reject(new Error('official connection client build failed with exit code ' + code))
  })
})
