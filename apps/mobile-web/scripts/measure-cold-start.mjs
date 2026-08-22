import { execFileSync } from 'node:child_process'
import process from 'node:process'
import WebSocket from 'ws'

const appId = 'top.noirbright.dshmobile'
const activity = appId + '/.MainActivity'
const budgetMs = Number(process.env.DSH_COLD_READY_BUDGET_MS ?? 8000)
const deadlineMs = Number(process.env.DSH_COLD_READY_DEADLINE_MS ?? 30000)
const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8' }).trim()
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const startedAt = performance.now()
const elapsed = () => Math.round(performance.now() - startedAt)

adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP')
adb('shell', 'wm', 'dismiss-keyguard')
adb('shell', 'am', 'force-stop', appId)
adb('shell', 'am', 'start', '-n', activity)
let pid = ''
for (let i = 0; i < 60 && pid === ''; i++) {
  try { pid = adb('shell', 'pidof', appId).replace(/\r/g, '') } catch {}
  if (pid === '') await delay(25)
}
if (pid === '') throw new Error('mobile process did not start')
try { adb('forward', '--remove', 'tcp:9222') } catch {}
adb('forward', 'tcp:9222', 'localabstract:webview_devtools_remote_' + pid)

let target
for (let i = 0; i < 100 && target === undefined; i++) {
  try {
    const targets = await fetch('http://127.0.0.1:9222/json').then(response => response.json())
    target = targets.find(item => item.type === 'page')
  } catch {}
  if (target === undefined) await delay(25)
}
if (target === undefined) throw new Error('WebView debugger target did not appear')
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject) })
let rpcId = 0
const pending = new Map()
socket.on('message', raw => {
  const message = JSON.parse(raw.toString())
  const waiter = pending.get(message.id)
  if (waiter === undefined) return
  pending.delete(message.id)
  message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result)
})
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++rpcId
  pending.set(id, { resolve, reject })
  socket.send(JSON.stringify({ id, method, params }))
})
const evaluate = expression => send('Runtime.evaluate', { expression, returnByValue: true })
  .then(result => result.result?.value)

const probeInstalledMs = elapsed()
const installProbeExpression = '(() => { const probe = window.__dshColdProbe = { start: performance.now(), writes: [] }; const at = () => Math.round(performance.now() - probe.start); const originalSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { const kind = key === "dsh-mobile:sessions-list:v1" ? "list" : key.startsWith("dsh-mobile:history:") ? "history" : key.startsWith("dsh-mobile:plugin:") ? "plugin" : null; if (kind !== null) probe.writes.push({ kind, at: at() }); return originalSetItem.call(this, key, value) } })()'
await evaluate(installProbeExpression)
const milestones = { processMs: elapsed(), debuggerMs: elapsed() }
let lastState = ''
const stateExpression = "(() => { const indicator = document.querySelector('[data-mobile-floating-connection-status]'); return JSON.stringify({ title: document.querySelector('[data-mobile-session-title]')?.textContent ?? null, display: indicator?.style.display ?? null, text: indicator?.textContent ?? null, contract: document.documentElement.dataset.dshLiveDataReadiness ?? null, writes: window.__dshColdProbe?.writes ?? [] }) })()"
while (elapsed() < deadlineMs) {
  const state = JSON.parse(await evaluate(stateExpression))
  if (state.title !== null && milestones.shellMs === undefined) milestones.shellMs = elapsed()
  if (state.display === 'flex' && state.text === '连接中…' && milestones.connectingMs === undefined) milestones.connectingMs = elapsed()
  if (state.display === 'flex' && state.text === '刷新中…' && milestones.refreshingMs === undefined) milestones.refreshingMs = elapsed()
  for (const write of state.writes) {
    const key = write.kind + 'WriteMs'
    if (milestones[key] === undefined) milestones[key] = probeInstalledMs + write.at
  }
  if (state.title !== null && state.display === 'none') {
    milestones.readyMs = elapsed()
    milestones.title = state.title
    break
  }
  const fingerprint = JSON.stringify(state)
  if (fingerprint !== lastState) {
    console.log(JSON.stringify({ atMs: elapsed(), ...state }))
    lastState = fingerprint
  }
  await delay(50)
}
socket.close()
console.log(JSON.stringify({ milestones, budgetMs }))
if (milestones.readyMs === undefined) {
  console.error('FAIL: authoritative cold-start refresh did not finish before deadline')
  process.exit(2)
}
if (milestones.readyMs > budgetMs) {
  console.error('FAIL: authoritative cold-start refresh exceeded budget by ' + (milestones.readyMs - budgetMs) + 'ms')
  process.exit(1)
}
console.log('PASS: authoritative cold-start refresh within budget')
