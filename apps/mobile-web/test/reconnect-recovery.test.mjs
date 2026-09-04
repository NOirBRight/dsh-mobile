import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { connectionRecoveryDecision, endpointRefreshRequired } from '../src/reconnect-recovery.ts'

test('only actionable failures stop automatic reconnect', () => {
  assert.equal(connectionRecoveryDecision('custom', 'retry-wait', 'network unavailable'), null)
  assert.equal(connectionRecoveryDecision('temporary', 'retry-wait', 'handshake: endpoint WebSocket connection failed'), 'endpoint')
  assert.equal(connectionRecoveryDecision('custom', 'retry-wait', 'credential is missing'), 'credential')
  assert.equal(connectionRecoveryDecision('custom', 'terminal', 'bad-token'), 'credential')
})

test('an unreachable temporary endpoint offers Endpoint Refresh recovery', () => {
  assert.equal(endpointRefreshRequired('temporary', 'handshake: endpoint WebSocket connection failed'), true)
  assert.equal(endpointRefreshRequired('temporary', 'direct signaling WebSocket connection failed'), true)
})

test('authorization errors and stable custom endpoints do not claim rotation', () => {
  assert.equal(endpointRefreshRequired('temporary', 'Host authorization revoked'), false)
  assert.equal(endpointRefreshRequired('custom', 'handshake: endpoint WebSocket connection failed'), false)
})

test('temporary handshake death is endpoint recovery even after the campaign goes terminal', () => {
  assert.equal(
    connectionRecoveryDecision('temporary', 'terminal', 'handshake: endpoint WebSocket connection failed'),
    'endpoint',
  )
})

test('rescan does not stop the new campaign as Active Host connection stopped', async () => {
  const source = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
  assert.equal(source.includes("lastError = 'Endpoint Refresh: '"), false)
  assert.equal(source.includes("if (nextActivity.phase === 'retry-wait' && recovery !== null)"), false)
  assert.ok(source.includes('endpointKind: next.profile.endpoint.kind'))
  assert.ok(source.includes("nextActivity.phase === 'connecting' && !nextActivity.reconnecting"))
  assert.match(source, /shellMounted = false\s+lastError = ''\s+endpointRefreshAvailable = false/)
  assert.ok(source.includes('session?.forgetPaint()'))
  assert.ok(source.includes('isHostSessionStoppedError'))
  assert.equal(source.split('if (isHostSessionStoppedError(error)) return').length - 1, 4)
  assert.ok(source.includes('mountProgressScreen'))
  assert.ok(source.includes("'正在连接 ' + activeConnection.profile.displayName"))
  assert.ok(source.includes("'正在加载 ' + activeConnection.profile.displayName"))
})

test('a disconnected pre-shell retry exposes the existing device menu instead of trapping the user', async () => {
  const source = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
  assert.ok(source.includes('const openProfileMenu = (): void =>'))
  assert.ok(source.includes("connectionOptions.textContent = '连接选项'"))
  assert.ok(source.includes('if (retrying || needsRecovery || showError)'))
  assert.equal(source.includes("refresh.id = 'endpoint-refresh'"), false)
})

test('a cold pairing shows a moving plugin count instead of an unexplained spinner', async () => {
  const source = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
  assert.ok(source.includes('onPluginProgress(loaded, total)'))
  assert.ok(source.includes("'正在拉取 Host 界面 ' + bootProgress.loaded + '/' + bootProgress.total"))
  assert.match(source, /shellMounted = true\s+bootProgress = null/)
  assert.ok(source.includes('pluginConcurrency: COLD_BOOT_PLUGIN_CONCURRENCY'))
})
