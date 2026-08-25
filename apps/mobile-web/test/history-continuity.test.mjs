import test from 'node:test'
import assert from 'node:assert/strict'
import { ExpandedHistoryLedger } from '../../../packages/ui-layout-mobile/src/client/history-continuity.ts'

test('ledger restores only a user-expanded boundary after a window shrink', async () => {
  const loads = []
  const ledger = new ExpandedHistoryLedger(async () => { loads.push('page') })
  ledger.observe({ firstSeq: 101, hasMore: true, loadingOlder: false })
  ledger.observe({ firstSeq: 51, hasMore: true, loadingOlder: false })
  assert.equal(ledger.boundary, 51)
  ledger.observe({ firstSeq: 101, hasMore: true, loadingOlder: false })
  await ledger.restoreIfNeeded(() => ({ firstSeq: loads.length === 0 ? 101 : 51, hasMore: true, loadingOlder: false }))
  assert.deepEqual(loads, ['page'])
})

test('initial tail windows never trigger generic prefetch', async () => {
  let loads = 0
  const ledger = new ExpandedHistoryLedger(async () => { loads += 1 })
  ledger.observe({ firstSeq: 101, hasMore: true, loadingOlder: false })
  await ledger.restoreIfNeeded(() => ({ firstSeq: 101, hasMore: true, loadingOlder: false }))
  assert.equal(loads, 0)
  assert.equal(ledger.boundary, null)
})

test('restoration pages never deepen the explicit expanded boundary', async () => {
  let firstSeq = 101
  let ledger
  ledger = new ExpandedHistoryLedger(async () => {
    firstSeq = 41
    ledger.observe({ firstSeq, hasMore: true, loadingOlder: false })
  })
  ledger.observe({ firstSeq: 101, hasMore: true, loadingOlder: false })
  ledger.observe({ firstSeq: 51, hasMore: true, loadingOlder: false })
  ledger.observe({ firstSeq: 101, hasMore: true, loadingOlder: false })
  await ledger.restoreIfNeeded(() => ({ firstSeq, hasMore: true, loadingOlder: false }))
  assert.equal(ledger.boundary, 51)
})

test('restoration stops paging when its session stops being current', async () => {
  let firstSeq = 151
  let current = true
  let loads = 0
  const ledger = new ExpandedHistoryLedger(async () => {
    loads += 1
    firstSeq -= 50
    current = false
  })
  ledger.observe({ firstSeq: 151, hasMore: true, loadingOlder: false })
  ledger.observe({ firstSeq: 1, hasMore: true, loadingOlder: false })
  ledger.observe({ firstSeq: 151, hasMore: true, loadingOlder: false })
  await ledger.restoreIfNeeded(
    () => ({ firstSeq, hasMore: true, loadingOlder: false }),
    () => current,
  )
  assert.equal(loads, 1)
})
