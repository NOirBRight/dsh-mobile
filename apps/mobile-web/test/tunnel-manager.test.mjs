import test from 'node:test'
import assert from 'node:assert/strict'
import { TunnelError } from '@dsh-mobile/e2e-tunnel'
import { connectionIndicatorPresentation, connectionRecoveryNotice, connectionRouteLabel, DeferredWebSocket, supportsLiveDataReadiness, isHostGatewaySocketPath, isPackagedShellPluginPath, isPublicEndpointPluginPath, shouldInstallTunnelShims, TunnelManager } from '../src/tunnel.ts'

test('legacy runtimes without the readiness contract do not leave refresh stuck forever', () => {
  assert.equal(supportsLiveDataReadiness({ dshLiveDataReadiness: 'v1' }), true)
  assert.equal(supportsLiveDataReadiness({}), false)
})

test('tunnel-only connections are not mislabeled as fallbacks', () => {
  assert.equal(connectionRouteLabel('direct', 'custom', 'automatic'), 'WebRTC Direct')
  assert.equal(connectionRouteLabel('tunnel', 'custom', 'tunnel-only'), 'Tunnel')
  assert.equal(connectionRouteLabel('tunnel', 'custom', 'automatic'), 'Tunnel Fallback')
  assert.equal(connectionRouteLabel('tunnel', 'relay', 'tunnel-only'), 'Relay')
})

test('transient reconnects stay out of the actionable topbar notice', () => {
  assert.equal(connectionRecoveryNotice(null, 'network unavailable'), null)
  assert.deepEqual(connectionRecoveryNotice('endpoint', 'dns failed'), {
    message: 'Host 的临时 Public Endpoint 可能已轮换。', detail: 'dns failed', actionLabel: '刷新',
  })
  assert.deepEqual(connectionRecoveryNotice('credential', 'credential is missing'), {
    message: '登录凭证已丢失，请重新扫码。', detail: 'credential is missing', actionLabel: '重新扫码',
  })
})

test('an active reconnect attempt is distinct from the first connection', () => {
  assert.deepEqual(connectionIndicatorPresentation({
    phase: 'connecting', attempt: 2, reconnecting: true, route: 'tunnel',
  }, 'Tunnel', true, false), {
    visible: true,
    text: '重连中…',
    label: 'Tunnel · 正在重连…',
    color: 'var(--dsw-alias-state-warn-primary, #f59e0b)',
  })
})

test('later automatic attempts stay passive while retry continues in the background', () => {
  assert.deepEqual(connectionIndicatorPresentation({
    phase: 'connecting', attempt: 3, reconnecting: true, route: 'tunnel',
  }, 'Tunnel', true, false), {
    visible: true,
    text: '离线',
    label: 'Tunnel · 连接中断，后台自动重试',
    color: 'var(--dsw-alias-state-error-primary, #ec1313)',
  })
})

test('retry backoff is a passive offline status instead of endless active refresh', () => {
  assert.deepEqual(connectionIndicatorPresentation({
    phase: 'retry-wait', attempt: 4, retryInMs: 8000, route: 'tunnel', error: 'network unavailable',
  }, 'Tunnel', true, false), {
    visible: true,
    text: '离线',
    label: 'Tunnel · 连接中断，后台自动重试',
    color: 'var(--dsw-alias-state-error-primary, #ec1313)',
  })
})

test('terminal recovery hides the floating indicator owned by the topbar', () => {
  assert.deepEqual(connectionIndicatorPresentation({
    phase: 'terminal', attempt: 1, route: 'tunnel', error: 'bad-token',
  }, 'Tunnel', true, false), {
    visible: false,
    text: '离线',
    label: 'Tunnel · 连接需要处理',
    color: 'var(--dsw-alias-state-error-primary, #ec1313)',
  })
})

test('floating connection indicator starts only after the cached conversation shell mounts', () => {
  assert.deepEqual(connectionIndicatorPresentation('connecting', '', false), {
    visible: false, text: '连接中…', label: '隧道连接中…',
    color: 'var(--dsw-alias-state-warn-primary, #f59e0b)',
  })
  assert.deepEqual(connectionIndicatorPresentation('connecting', '', true), {
    visible: true, text: '连接中…', label: '隧道连接中…',
    color: 'var(--dsw-alias-state-warn-primary, #f59e0b)',
  })
})

test('floating connection indicator follows theme and waits for authoritative live data after transport open', () => {
  assert.deepEqual(connectionIndicatorPresentation('closed', 'Tunnel Fallback', true, false), {
    visible: true, text: '重连中…', label: 'Tunnel Fallback · 隧道已断开，重连中',
    color: 'var(--dsw-alias-state-error-primary, #ec1313)',
  })
  assert.deepEqual(connectionIndicatorPresentation('open', 'WebRTC Direct', true, false), {
    visible: true, text: '刷新中…', label: 'WebRTC Direct · 正在刷新权威数据…',
    color: 'var(--dsw-alias-state-warn-primary, #f59e0b)',
  })
  assert.deepEqual(connectionIndicatorPresentation('open', 'WebRTC Direct', true, true), {
    visible: false, text: '已更新', label: 'WebRTC Direct · 权威数据已刷新',
    color: 'var(--dsw-alias-state-success-primary, #22c55e)',
  })
})

test('bare same-origin Host bridge keeps native API while paired and native shells install tunnel shims', () => {
  assert.equal(shouldInstallTunnelShims(true), false)
  assert.equal(shouldInstallTunnelShims(false), true)
})

test('packaged mobile layout is not a tunneled Host plugin path', () => {
  assert.equal(isPackagedShellPluginPath('/plugins/@dsh-mobile/ui-layout-mobile/client.js'), true)
  assert.equal(isPackagedShellPluginPath('/plugins/@deepseek-ai/dsh-client-ui-layout/client.js'), false)
})

test('Host Gateway signal and tunnel paths are not tunneled sockets', () => {
  assert.equal(isHostGatewaySocketPath('/signal/check'), true)
  assert.equal(isHostGatewaySocketPath('/signal/' + 'a'.repeat(32)), true)
  assert.equal(isHostGatewaySocketPath('/tunnel/' + 'b'.repeat(32)), true)
  assert.equal(isHostGatewaySocketPath('/api/events.mux'), false)
  assert.equal(isHostGatewaySocketPath('/healthz'), false)
})

test('Host plugin bundles except the packaged layout are tunneled application paths', () => {
  assert.equal(isPublicEndpointPluginPath('/plugins/@deepseek-ai/dsh-typert-registry/client.js'), true)
  assert.equal(isPublicEndpointPluginPath('/plugins/@dsh-mobile/ui-layout-mobile/client.js'), false)
  assert.equal(isPublicEndpointPluginPath('/api/host.describe'), false)
})

const keypair = { publicKey: new Uint8Array(32).fill(1), secretKey: new Uint8Array(32).fill(2) }

test('TunnelManager loads and disposes private credentials and surfaces active route', async () => {
  let disposed = false
  let closed = false
  const statuses = []
  const client = { state: 'open', deviceToken: 'token', fetch() {}, openWebSocket() {}, probe: async () => {}, close() { closed = true } }
  const manager = new TunnelManager({
    offerUrl: 'offer', connectionPolicy: 'automatic',
    loadCredentials: async () => ({ clientKeypair: keypair, deviceToken: 'token', onDeviceToken: async () => {}, dispose: () => { disposed = true } }),
    connect: async (_offer, options) => { options.onConnectionStatus({ phase: 'direct-open', route: 'direct' }); return client },
    onState: () => {}, onConnectionStatus: status => statuses.push(status),
  })
  manager.start()
  assert.equal(await manager.current(), client)
  assert.equal(disposed, true)
  assert.equal(statuses.at(-1).route, 'direct')
  manager.stop()
  assert.equal(closed, true)
})

test('TunnelManager rejects readiness and never reconnects terminal Host authorization failures', async () => {
  let attempts = 0
  let waits = 0
  const manager = new TunnelManager({
    offerUrl: 'offer', connectionPolicy: 'automatic',
    loadCredentials: async () => ({ clientKeypair: keypair, deviceToken: 'revoked', onDeviceToken: async () => {}, dispose() {} }),
    connect: async () => { attempts += 1; throw new TunnelError('bad-token') },
    wait: async () => { waits += 1 }, onState: () => {},
  })
  manager.start()
  await assert.rejects(manager.current(), error => error.code === 'bad-token')
  assert.equal(attempts, 1)
  assert.equal(waits, 0)
})

test('TunnelManager separates active reconnect attempts from passive retry waits', async () => {
  let attempts = 0
  const activities = []
  const waits = []
  const client = { state: 'open', deviceToken: 'token', fetch() {}, openWebSocket() {}, probe: async () => {}, close() {} }
  const manager = new TunnelManager({
    offerUrl: 'offer', connectionPolicy: 'tunnel-only', random: () => 0.5,
    loadCredentials: async () => ({ clientKeypair: keypair, deviceToken: 'token', onDeviceToken: async () => {}, dispose() {} }),
    connect: async () => {
      attempts += 1
      if (attempts < 3) throw new Error('network unavailable')
      return client
    },
    wait: async delayMs => { waits.push(delayMs) },
    onState: () => {}, onActivity: activity => activities.push(activity),
  })
  manager.start()
  assert.equal(await manager.current(), client)
  assert.deepEqual(activities.map(activity => activity.phase), [
    'connecting', 'retry-wait', 'connecting', 'retry-wait', 'connecting', 'open',
  ])
  assert.deepEqual(waits, [1000, 2000])
  assert.deepEqual(activities.filter(activity => activity.phase === 'retry-wait').map(activity => activity.retryInMs), [1000, 2000])
  manager.stop()
})

test('TunnelManager backs prolonged outages off to one attempt per minute', async () => {
  let attempts = 0
  const waits = []
  const client = { state: 'open', deviceToken: 'token', fetch() {}, openWebSocket() {}, probe: async () => {}, close() {} }
  const manager = new TunnelManager({
    offerUrl: 'offer', connectionPolicy: 'tunnel-only', random: () => 0.5,
    loadCredentials: async () => ({ clientKeypair: keypair, deviceToken: 'token', onDeviceToken: async () => {}, dispose() {} }),
    connect: async () => {
      attempts += 1
      if (attempts < 9) throw new Error('offline')
      return client
    },
    wait: async delayMs => { waits.push(delayMs) }, onState: () => {},
  })
  manager.start()
  assert.equal(await manager.current(), client)
  assert.deepEqual(waits, [1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000])
  manager.stop()
})

test('network recovery wakes a passive retry immediately', async () => {
  let attempts = 0
  let releaseWait
  let markWaiting
  const waiting = new Promise(resolve => { markWaiting = resolve })
  const client = { state: 'open', deviceToken: 'token', fetch() {}, openWebSocket() {}, probe: async () => {}, close() {} }
  const manager = new TunnelManager({
    offerUrl: 'offer', connectionPolicy: 'tunnel-only',
    loadCredentials: async () => ({ clientKeypair: keypair, deviceToken: 'token', onDeviceToken: async () => {}, dispose() {} }),
    connect: async () => {
      attempts += 1
      if (attempts === 1) throw new Error('offline')
      return client
    },
    wait: async () => { markWaiting(); await new Promise(resolve => { releaseWait = resolve }) },
    onState: () => {},
  })
  manager.start()
  const pending = manager.current()
  await waiting
  await manager.probeNow()
  const result = await Promise.race([pending, new Promise(resolve => setTimeout(() => resolve('timeout'), 25))])
  manager.stop()
  releaseWait?.()
  assert.equal(result, client)
})

test('TunnelManager.stop cancels an in-flight connect, closes the late client, and rejects waiters', async () => {
  let released
  const hold = new Promise(resolve => { released = resolve })
  let connectStarted
  const started = new Promise(resolve => { connectStarted = resolve })
  let closed = 0
  const client = { state: 'open', deviceToken: 'token', fetch() {}, openWebSocket() {}, probe: async () => {}, close() { closed += 1 } }
  const manager = new TunnelManager({
    offerUrl: 'offer', connectionPolicy: 'automatic',
    loadCredentials: async () => ({ clientKeypair: keypair, deviceToken: 'token', onDeviceToken: async () => {}, dispose() {} }),
    connect: async () => { connectStarted(); await hold; return client },
    onState: () => {},
  })
  manager.start()
  await started
  const pending = manager.current()
  manager.stop()
  await assert.rejects(pending, error => error.code === 'closed')
  released()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(closed, 1)
  await assert.rejects(manager.current(), error => error.code === 'closed')
})

test('TunnelManager ignores late transport callbacks after stop', async () => {
  let released
  let connectStarted
  const hold = new Promise(resolve => { released = resolve })
  const started = new Promise(resolve => { connectStarted = resolve })
  const states = []
  const statuses = []
  const errors = []
  const client = { state: 'open', deviceToken: 'token', fetch() {}, openWebSocket() {}, probe: async () => {}, close() {} }
  const manager = new TunnelManager({
    offerUrl: 'offer', connectionPolicy: 'automatic',
    loadCredentials: async () => ({ clientKeypair: keypair, deviceToken: 'token', onDeviceToken: async () => {}, dispose() {} }),
    connect: async (_offer, options) => {
      connectStarted()
      await hold
      options.onStateChange('open')
      options.onConnectionStatus({ phase: 'direct-open', route: 'direct' })
      return client
    },
    onState: state => states.push(state),
    onConnectionStatus: status => statuses.push(status),
    onError: error => errors.push(error),
  })
  manager.start()
  await started
  manager.stop()
  released()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(states, [])
  assert.deepEqual(statuses, [])
  assert.deepEqual(errors, [])
})

test('DeferredWebSocket emits error and close when tunnel readiness is terminal', async () => {
  const previous = globalThis.location
  globalThis.location = { origin: 'https://localhost', host: 'localhost' }
  try {
    const manager = new TunnelManager({
      offerUrl: 'offer', connectionPolicy: 'automatic',
      loadCredentials: async () => ({ clientKeypair: keypair, deviceToken: 'revoked', onDeviceToken: async () => {}, dispose() {} }),
      connect: async () => { throw new TunnelError('bad-token') },
      onState: () => {},
    })
    manager.start()
    const sock = new DeferredWebSocket(manager, class {}, 'wss://localhost/api/events')
    const saw = { error: 0, close: 0 }
    sock.onerror = () => { saw.error += 1 }
    sock.onclose = () => { saw.close += 1 }
    await assert.rejects(manager.current(), error => error.code === 'bad-token')
    assert.equal(sock.readyState, 3)
    assert.equal(saw.error, 1)
    assert.equal(saw.close, 1)
  } finally {
    if (previous === undefined) delete globalThis.location
    else globalThis.location = previous
  }
})

test('deferred heartbeat does not probe until armed after boot', async () => {
  let probes = 0
  const client = { state: 'open', deviceToken: 'token', fetch() {}, openWebSocket() {}, probe: async () => { probes += 1 }, close() {} }
  const manager = new TunnelManager({
    offerUrl: 'offer', connectionPolicy: 'automatic', deferHeartbeat: true,
    loadCredentials: async () => ({ clientKeypair: keypair, deviceToken: 'token', onDeviceToken: async () => {}, dispose() {} }),
    connect: async () => client,
    onState: () => {},
  })
  manager.start()
  assert.equal(await manager.current(), client)
  await manager.probeNow()
  assert.equal(probes, 0)
  manager.armHeartbeat()
  await manager.probeNow()
  assert.equal(probes, 1)
  manager.stop()
})

test('Automatic reconnects through Tunnel Fallback after a live Direct session dies', async () => {
  const policies = []
  const first = { state: 'open', deviceToken: 'token', fetch() {}, openWebSocket() {}, probe: async () => {}, close() {} }
  const second = { state: 'open', deviceToken: 'token', fetch() {}, openWebSocket() {}, probe: async () => {}, close() {} }
  const manager = new TunnelManager({
    offerUrl: 'offer', connectionPolicy: 'automatic',
    loadCredentials: async () => ({ clientKeypair: keypair, deviceToken: 'token', onDeviceToken: async () => {}, dispose() {} }),
    connect: async (_offer, options) => {
      policies.push(options.connectionPolicy)
      if (policies.length === 1) {
        options.onConnectionStatus({ phase: 'direct-open', route: 'direct' })
        first.close = () => { first.state = 'closed'; options.onStateChange('closed') }
        return first
      }
      options.onConnectionStatus({ phase: 'tunnel-open', route: 'tunnel' })
      return second
    },
    wait: async () => {},
    onState: () => {},
  })
  manager.start()
  assert.equal(await manager.current(), first)
  first.close()
  assert.equal(await manager.current(), second)
  assert.deepEqual(policies, ['automatic', 'tunnel-only'])
  manager.stop()
})

test('DeferredWebSocket uses the native socket for same-origin Host Gateway paths', async () => {
  const previous = globalThis.location
  globalThis.location = { origin: 'https://example.trycloudflare.com', host: 'example.trycloudflare.com' }
  const opened = []
  class NativeWS {
    constructor(url) { opened.push(url); this.readyState = 1 }
    send() {}
    close() {}
    addEventListener() {}
  }
  try {
    const manager = new TunnelManager({
      offerUrl: 'offer', connectionPolicy: 'automatic',
      loadCredentials: async () => ({ clientKeypair: keypair, deviceToken: 'token', onDeviceToken: async () => {}, dispose() {} }),
      connect: async () => { throw new Error('connect must not run for Gateway sockets') },
      onState: () => {},
    })
    const signal = new DeferredWebSocket(manager, NativeWS, 'wss://example.trycloudflare.com/signal/' + 'c'.repeat(32))
    const check = new DeferredWebSocket(manager, NativeWS, 'wss://example.trycloudflare.com/signal/check')
    const tunnel = new DeferredWebSocket(manager, NativeWS, 'wss://example.trycloudflare.com/tunnel/' + 'd'.repeat(32))
    assert.equal(signal.readyState, 1)
    assert.equal(check.readyState, 1)
    assert.equal(tunnel.readyState, 1)
    assert.deepEqual(opened, [
      'wss://example.trycloudflare.com/signal/' + 'c'.repeat(32),
      'wss://example.trycloudflare.com/signal/check',
      'wss://example.trycloudflare.com/tunnel/' + 'd'.repeat(32),
    ])
  } finally {
    if (previous === undefined) delete globalThis.location
    else globalThis.location = previous
  }
})
