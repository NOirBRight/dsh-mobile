/**
 * Read live shell state from the paired Android WebView over CDP.
 *
 * Usage: adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>
 *        node scripts/inspect-device-shell.mjs [expression]
 */
import { WebSocket } from 'ws'

const port = process.env.DSH_DEVTOOLS_PORT ?? '9333'
const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()
const page = targets.find(row => row.type === 'page')
if (page === undefined) throw new Error('no page target on port ' + port)

const expression = process.argv[2] ?? `(() => {
  const overlay = document.querySelector('[data-mobile-progress]')
  return JSON.stringify({
    url: location.href,
    title: document.title,
    boot: typeof window.__DSH_BOOT__ === 'undefined' ? null : (window.__DSH_BOOT__.rev ?? 'present'),
    overlay: overlay === null ? null : {
      title: overlay.querySelector('.dsh-progress-title')?.textContent ?? null,
      detail: overlay.querySelector('.dsh-progress-detail')?.textContent ?? null,
      error: overlay.querySelector('.dsh-progress-error')?.textContent ?? null,
    },
    rootChildren: [...(document.getElementById('root')?.children ?? [])].map(el => el.tagName + '.' + el.className),
    bodyChildren: [...document.body.children].map(el => el.tagName + (el.id ? '#' + el.id : '') + '.' + el.className),
  }, null, 2)
})()`

const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false })
ws.on('open', () => {
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }))
})
ws.on('message', raw => {
  const message = JSON.parse(raw.toString())
  if (message.id !== 1) return
  const result = message.result?.result
  console.log(result?.value ?? JSON.stringify(message, null, 2))
  ws.close()
})
ws.on('error', error => {
  console.error(error.message)
  process.exit(1)
})
