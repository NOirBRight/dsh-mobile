import { execFileSync } from 'node:child_process'
import WebSocket from 'ws'

const appId = 'top.noirbright.dshmobile'
const activity = appId + '/.MainActivity'
const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8' }).trim()
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const startedAt = performance.now()
const elapsed = () => Math.round(performance.now() - startedAt)

const wifiWasOn = adb('shell', 'settings', 'get', 'global', 'wifi_on') === '1'
const dataWasOn = adb('shell', 'settings', 'get', 'global', 'mobile_data') === '1'
let socket
let disabled = false

async function attach() {
  adb('shell', 'am', 'force-stop', appId)
  adb('shell', 'am', 'start', '-n', activity)
  let pid = ''
  for (let i = 0; i < 100 && pid === ''; i++) {
    try { pid = adb('shell', 'pidof', appId).replace(/\r/g, '') } catch {}
    if (pid === '') await delay(25)
  }
  if (pid === '') throw new Error('mobile process did not start')
  try { adb('forward', '--remove', 'tcp:9222') } catch {}
  adb('forward', 'tcp:9222', 'localabstract:webview_devtools_remote_' + pid)
  let target
  for (let i = 0; i < 120 && target === undefined; i++) {
    try {
      const targets = await fetch('http://127.0.0.1:9222/json').then(response => response.json())
      target = targets.find(item => item.type === 'page')
    } catch {}
    if (target === undefined) await delay(25)
  }
  if (target === undefined) throw new Error('WebView debugger target did not appear')
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject) })
  let id = 0
  const pending = new Map()
  socket.on('message', raw => {
    const message = JSON.parse(raw.toString())
    const waiter = pending.get(message.id)
    if (waiter === undefined) return
    pending.delete(message.id)
    message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result)
  })
  return expression => new Promise((resolve, reject) => {
    const requestId = ++id
    pending.set(requestId, { resolve, reject })
    socket.send(JSON.stringify({ id: requestId, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }))
  }).then(result => result.result?.value)
}

const stateExpression = "(() => { const floating = document.querySelector('[data-mobile-floating-connection-status]'); const notice = document.querySelector('[data-mobile-topbar-notice]'); return JSON.stringify({ title: document.querySelector('[data-mobile-session-title]')?.textContent ?? null, floatingVisible: floating?.style.display === 'flex', floatingText: floating?.textContent ?? null, noticeVisible: notice !== null && !notice.hidden && getComputedStyle(notice).display !== 'none', noticeText: notice?.textContent ?? null }) })()"

try {
  const evaluate = await attach()
  let ready = false
  for (let i = 0; i < 300 && !ready; i++) {
    const state = JSON.parse(await evaluate(stateExpression))
    ready = state.title !== null && !state.floatingVisible
    if (!ready) await delay(50)
  }
  if (!ready) throw new Error('app did not reach ready before disconnect')

  adb('shell', 'svc', 'wifi', 'disable')
  adb('shell', 'svc', 'data', 'disable')
  disabled = true

  let last = ''
  let sawOffline = false
  let sawDual = false
  const offlineDeadline = performance.now() + 25_000
  while (performance.now() < offlineDeadline) {
    const state = JSON.parse(await evaluate(stateExpression))
    sawOffline ||= state.floatingVisible && state.floatingText === '离线'
    sawDual ||= state.floatingVisible && state.noticeVisible
    const fingerprint = JSON.stringify(state)
    if (fingerprint !== last) {
      console.log(JSON.stringify({ atMs: elapsed(), phase: 'offline', ...state }))
      last = fingerprint
    }
    if (sawOffline && elapsed() > 12_000) break
    await delay(100)
  }
  if (!sawOffline) throw new Error('disconnect never entered passive offline presentation')
  if (sawDual) throw new Error('floating status and topbar notice were visible together')

  if (wifiWasOn) adb('shell', 'svc', 'wifi', 'enable')
  if (dataWasOn) adb('shell', 'svc', 'data', 'enable')
  disabled = false
  let reachable = false
  for (let i = 0; i < 30 && !reachable; i++) {
    try { adb('shell', 'ping', '-c', '1', '-W', '1', 'pair.noirbright.top'); reachable = true } catch {}
    if (!reachable) await delay(500)
  }
  if (!reachable) throw new Error('Android network did not become reachable after restore')
  await evaluate("window.dispatchEvent(new Event('online'))")

  let recovered = false
  const recoveryDeadline = performance.now() + 25_000
  while (performance.now() < recoveryDeadline && !recovered) {
    const state = JSON.parse(await evaluate(stateExpression))
    recovered = state.title !== null && !state.floatingVisible && !state.noticeVisible
    const fingerprint = JSON.stringify(state)
    if (fingerprint !== last) {
      console.log(JSON.stringify({ atMs: elapsed(), phase: 'recovery', ...state }))
      last = fingerprint
    }
    if (!recovered) await delay(100)
  }
  if (!recovered) throw new Error('network recovery did not return to authoritative ready')
  console.log('PASS: disconnect has one passive owner and recovers immediately')
} finally {
  if (disabled) {
    if (wifiWasOn) adb('shell', 'svc', 'wifi', 'enable')
    if (dataWasOn) adb('shell', 'svc', 'data', 'enable')
  }
  socket?.close()
}
