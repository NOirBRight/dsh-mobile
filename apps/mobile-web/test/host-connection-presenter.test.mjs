import test from 'node:test'
import assert from 'node:assert/strict'
import {
  HOST_CONNECTION_STATE_EVENT,
  asHostConnectionState,
  installHostConnectionPresenter,
} from '../../../packages/ui-layout-mobile/src/client/host-connection-presenter.ts'

test('Host connection snapshots only accept the official generation states', () => {
  assert.equal(asHostConnectionState('connected'), 'connected')
  assert.equal(asHostConnectionState('disconnected'), 'disconnected')
  assert.equal(asHostConnectionState('connecting'), 'connecting')
  assert.equal(asHostConnectionState(undefined), undefined)
  assert.equal(asHostConnectionState('open'), undefined)
})

test('presenter republishes Host connection.state onto the document', () => {
  const listeners = new Set()
  let snapshot = 'disconnected'
  const connection = {
    state: {
      getSnapshot() { return snapshot },
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
  }
  const target = new EventTarget()
  const seen = []
  target.addEventListener(HOST_CONNECTION_STATE_EVENT, event => {
    seen.push(event.detail.state)
  })
  const off = installHostConnectionPresenter(connection, target)
  snapshot = 'connected'
  for (const listener of listeners) listener()
  off()
  snapshot = 'connecting'
  for (const listener of listeners) listener()
  assert.deepEqual(seen, ['disconnected', 'connected'])
})
