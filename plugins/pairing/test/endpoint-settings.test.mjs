import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  applyPublicEndpointSelection,
  loadPublicEndpointOverlay,
  parseEndpointSelection,
  savePublicEndpointOverlay,
} from '../src/endpoint-settings.ts'

const ready = {
  fetch: async () => ({ ok: true, status: 200, json: async () => ({ protocol: 1, hostIdentity: 'host-key', capabilities: { browser: false, direct: true, tunnel: true, endpointRefresh: true } }) }),
  openWebSocket: async () => ({ close() {} }),
}

test('parseEndpointSelection accepts quick and custom payloads', () => {
  assert.deepEqual(parseEndpointSelection({ endpointMode: 'quick' }), { endpointMode: 'quick' })
  assert.deepEqual(parseEndpointSelection({ endpointMode: 'custom', customEndpointUrl: ' https://host.example ' }), {
    endpointMode: 'custom', customEndpointUrl: 'https://host.example',
  })
  assert.equal(parseEndpointSelection({ endpointMode: 'custom' }).error, 'customEndpointUrl is required in custom mode')
  assert.equal(parseEndpointSelection({ endpointMode: 'relay' }).error, 'endpointMode must be quick or custom')
})

test('custom save runs staged check and rejects a foreign Host Identity', async () => {
  const passed = await applyPublicEndpointSelection(
    { endpointMode: 'custom', customEndpointUrl: 'https://host.example' },
    { hostIdentity: 'host-key', adapters: ready },
  )
  assert.deepEqual(passed, {
    ok: true, endpointMode: 'custom',
    endpoint: { url: 'https://host.example', kind: 'custom' },
    check: { ok: true, stage: 'ready', hostIdentity: 'host-key', capabilities: { browser: false, direct: true, tunnel: true, endpointRefresh: true } },
  })

  const foreign = await applyPublicEndpointSelection(
    { endpointMode: 'custom', customEndpointUrl: 'https://host.example' },
    { hostIdentity: 'other-host', adapters: ready },
  )
  assert.deepEqual(foreign, { ok: false, stage: 'identity', error: 'endpoint Host Identity does not match this Host' })

  const failed = await applyPublicEndpointSelection(
    { endpointMode: 'custom', customEndpointUrl: 'https://host.example' },
    { hostIdentity: 'host-key', adapters: { fetch: async () => { throw new Error('certificate expired') }, openWebSocket: async () => ({ close() {} }) } },
  )
  assert.equal(failed.ok, false)
  assert.equal(failed.stage, 'tls')
})

test('quick save skips the custom endpoint probe', async () => {
  let fetched = 0
  const result = await applyPublicEndpointSelection({ endpointMode: 'quick' }, {
    hostIdentity: 'host-key',
    adapters: { fetch: async () => { fetched += 1; return ready.fetch() }, openWebSocket: ready.openWebSocket },
  })
  assert.deepEqual(result, { ok: true, endpointMode: 'quick' })
  assert.equal(fetched, 0)
})

test('public endpoint overlay persists and rejects a corrupt file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-endpoint-'))
  const path = join(dir, 'public-endpoint.json')
  assert.equal(loadPublicEndpointOverlay(path), null)
  savePublicEndpointOverlay(path, { endpointMode: 'custom', customEndpointUrl: 'https://host.example' })
  assert.deepEqual(loadPublicEndpointOverlay(path), { endpointMode: 'custom', customEndpointUrl: 'https://host.example' })
  writeFileSync(path, '{')
  assert.throws(() => loadPublicEndpointOverlay(path), /unreadable public endpoint overlay/)
})
