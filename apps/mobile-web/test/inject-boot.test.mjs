import test from 'node:test'
import assert from 'node:assert/strict'
import { TunnelError } from '@dsh-mobile/e2e-tunnel'
import { injectBootManifestFromTunnel } from '../src/tunnel.ts'

test('injectBootManifestFromTunnel aborts a hung boot fetch instead of waiting forever', async () => {
  let receivedSignal
  const client = {
    fetch(_url, init) {
      receivedSignal = init.signal
      return new Promise(() => {})
    },
  }
  const pending = injectBootManifestFromTunnel(client, {
    viewportWidth: 400,
    fetchTimeoutMs: 20,
    localizePlugins: false,
  })
  await assert.rejects(pending, error => error instanceof TunnelError && error.code === 'timeout')
  assert.equal(receivedSignal.aborted, true)
})
