import {
  createMemorySessionRecordStore,
  createSessionCache,
} from '../../../../../packages/ui-layout-mobile/src/client/session-cache.ts'
import { installColdStartOverlayAdapter } from '../../../../../packages/ui-layout-mobile/src/client/cold-start-overlay.ts'

function observable<T>(initial: T) {
  const listeners = new Set<() => void>()
  let snapshot = initial
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set(next: T) {
      snapshot = next
      for (const listener of listeners) listener()
    },
  }
}

const event = {
  type: 'user/message',
  seq: 1,
  time: 1,
  data: { text: 'cached hello' },
}

const store = createMemorySessionRecordStore()
const cache = createSessionCache('host-a', store)
const session = observable({ openState: 'loading' as string })
const eventSource = observable({
  entries: [] as const,
  hasMore: false,
  revision: 0,
  change: { kind: 'replace' as const, entries: [] as const },
})
const list = observable({
  phase: 'pending' as 'pending' | 'ready',
  ids: [] as string[],
  byId: {} as Record<string, { id: string; title: string; updatedAt: number; blank: boolean; running: boolean }>,
  current: undefined as string | undefined,
})
const opened: string[] = []
let sent = 0

document.documentElement.dataset.dshMobileHostId = 'host-a'
document.documentElement.dataset.dshMobileConnectionGeneration = '1'
document.body.innerHTML = `
  <div data-drawer-open>
    <nav aria-label="导航抽屉">
      <div data-official-sidebar>official empty</div>
    </nav>
    <main>
      <div data-chat-scroll>official empty conversation</div>
      <div data-composer-card>
        <textarea></textarea>
        <button type="button" aria-label="发送">Send</button>
      </div>
    </main>
    <div data-shell-overlay><button type="button" data-codex-toggle>Codex</button></div>
  </div>
`

const send = document.querySelector<HTMLButtonElement>('button[aria-label="发送"]')!
send.addEventListener('click', () => { sent += 1 })
send.addEventListener('keydown', () => { sent += 1 })

void cache.writeList([{ sessionId: 's1', title: 'Cached task', updatedAt: 1, blank: false }]).then(async () => {
  await cache.writeWindow('s1', { entries: [{ event }], hasMore: false })
  const dispose = installColdStartOverlayAdapter({
    sessions: {
      list,
      binding: (id: string) => id === 's1' ? { session, eventSource } : undefined,
      open(id: string) {
        if (!(list.getSnapshot().ids ?? []).includes(id)) throw new Error('unknown ' + id)
        opened.push(id)
      },
      async refresh() {},
    },
  }, { document, cache, createCache: () => cache })

  window.setTimeout(() => {
    const listOverlay = document.querySelector<HTMLElement>('[data-mobile-cold-start-list-overlay]')
    const conversation = document.querySelector<HTMLElement>('[data-mobile-cold-start-conversation-overlay]')
    const row = document.querySelector<HTMLButtonElement>('[data-mobile-cold-start-session-id]')
    const textarea = document.querySelector('textarea')!
    document.body.dataset.listParent = listOverlay?.parentElement?.getAttribute('aria-label') ?? ''
    document.body.dataset.listInShell = String(listOverlay?.closest('[data-shell-overlay]') !== null)
    document.body.dataset.conversationInShell = String(conversation?.closest('[data-shell-overlay]') !== null)
    document.body.dataset.codexSurvived = String(document.querySelector('[data-codex-toggle]') !== null)
    document.body.dataset.rowTitle = row?.textContent ?? ''
    document.body.dataset.eventText = conversation?.textContent ?? ''
    document.body.dataset.listHiddenPending = String(listOverlay?.hidden === true)
    row?.click()
    send.click()
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    document.body.dataset.sendWhileLocked = String(sent)
    document.body.dataset.openedWhilePending = opened.join(',')

    const live = { id: 's1', title: 'Cached task', updatedAt: 1, blank: false, running: false }
    list.set({ phase: 'ready', ids: ['s1'], byId: { s1: live }, current: 's1' })
    window.setTimeout(() => {
      session.set({ openState: 'open' })
      eventSource.set({ entries: [], hasMore: false, revision: 1, change: { kind: 'replace', entries: [] } })
      window.setTimeout(() => {
        send.click()
        document.body.dataset.listHiddenReady = String(listOverlay?.hidden === true)
        document.body.dataset.conversationHiddenReady = String(conversation?.hidden === true)
        document.body.dataset.openedAfterReady = opened.join(',')
        document.body.dataset.sendAfterReady = String(sent)
        document.body.dataset.ready = 'true'
        dispose()
      }, 40)
    }, 40)
  }, 40)
})
