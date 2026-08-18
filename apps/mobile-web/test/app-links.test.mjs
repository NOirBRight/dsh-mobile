import test from 'node:test'
import assert from 'node:assert/strict'
import { AppLinkInbox } from '../src/app-links.ts'

test('cold appUrlOpen is consumed by bootstrap without reloading it away', () => {
  const navigations = []
  const inbox = new AppLinkInbox(url => url.startsWith('dsh-mobile://pair#offer=') ? url : null, url => navigations.push(url))
  inbox.capture('dsh-mobile://pair#offer=cold')
  assert.deepEqual(navigations, [])
  assert.equal(inbox.takeInitial(undefined), 'dsh-mobile://pair#offer=cold')
  inbox.arm()
  inbox.capture('dsh-mobile://pair#offer=warm')
  assert.deepEqual(navigations, ['dsh-mobile://pair#offer=warm'])
})

test('invalid and duplicate deep links are ignored', () => {
  const navigations = []
  const inbox = new AppLinkInbox(url => url === 'valid' ? url : null, url => navigations.push(url))
  inbox.capture('invalid')
  assert.equal(inbox.takeInitial(undefined), undefined)
  inbox.arm(); inbox.capture('valid'); inbox.capture('valid')
  assert.deepEqual(navigations, ['valid'])
})
