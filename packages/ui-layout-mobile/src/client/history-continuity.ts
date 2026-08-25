/** Preserve only the history depth a reader explicitly expanded in this app lifetime. */

export interface HistoryWindowReading {
  readonly firstSeq: number | null
  readonly hasMore: boolean
  readonly loadingOlder: boolean
}

export class ExpandedHistoryLedger {
  #previousFirst: number | null = null
  #boundary: number | null = null
  #needsRestore = false
  #restoring = false
  readonly #loadOlder: () => Promise<void>

  constructor(loadOlder: () => Promise<void>) {
    this.#loadOlder = loadOlder
  }

  get boundary(): number | null { return this.#boundary }

  observe(reading: HistoryWindowReading): void {
    const first = reading.firstSeq
    if (first === null) return
    if (this.#restoring) {
      this.#previousFirst = first
      return
    }
    if (this.#previousFirst !== null && first < this.#previousFirst) {
      this.#boundary = this.#boundary === null ? first : Math.min(this.#boundary, first)
    }
    if (this.#boundary !== null && first > this.#boundary) this.#needsRestore = true
    this.#previousFirst = first
  }

  async restoreIfNeeded(
    read: () => HistoryWindowReading,
    shouldContinue: () => boolean = () => true,
  ): Promise<void> {
    if (this.#restoring || !this.#needsRestore || this.#boundary === null || !shouldContinue()) return
    this.#restoring = true
    try {
      for (let page = 0; page < 64 && shouldContinue(); page += 1) {
        const before = read()
        if (before.firstSeq === null || before.firstSeq <= this.#boundary || !before.hasMore) {
          this.#needsRestore = false
          return
        }
        if (before.loadingOlder) return
        await this.#loadOlder()
        if (!shouldContinue()) return
        const after = read()
        if (after.firstSeq === null || after.firstSeq >= before.firstSeq) return
        // Restoration is policy work, not another explicit reader expansion.
        // Advance observation state without moving the remembered boundary.
        this.#previousFirst = after.firstSeq
        if (after.firstSeq <= this.#boundary) {
          this.#needsRestore = false
          return
        }
      }
    } finally {
      this.#restoring = false
    }
  }
}

interface ObservableSession {
  getSnapshot(): unknown
  subscribe(listener: () => void): () => void
  loadOlder(): Promise<void>
}

interface SessionsLike {
  list: { getSnapshot(): { current?: string }; subscribe(listener: () => void): () => void }
  binding(id: string): { session: ObservableSession } | undefined
}

interface SessionsContext {
  get?(name: string, strict?: boolean): unknown
  sessions?: unknown
}

interface ReaderAnchor { readonly key: string; readonly top: number }

function firstSeqOf(snapshot: unknown): number | null {
  if (snapshot === null || typeof snapshot !== 'object') return null
  const nodes = (snapshot as { nodes?: readonly unknown[] }).nodes
  if (!Array.isArray(nodes)) return null
  let first: number | null = null
  for (const node of nodes) {
    if (node === null || typeof node !== 'object') continue
    const candidate = node as { anchorSeq?: unknown; seq?: unknown }
    const seq = typeof candidate.anchorSeq === 'number' ? candidate.anchorSeq : typeof candidate.seq === 'number' ? candidate.seq : null
    if (seq !== null && (first === null || seq < first)) first = seq
  }
  return first
}

function readingOf(session: ObservableSession): HistoryWindowReading {
  const snapshot = session.getSnapshot() as { hasMore?: unknown; loadingOlder?: unknown }
  return {
    firstSeq: firstSeqOf(snapshot),
    hasMore: snapshot?.hasMore === true,
    loadingOlder: snapshot?.loadingOlder === true,
  }
}

function captureReaderAnchor(document: Document): ReaderAnchor | null {
  const scroller = document.querySelector<HTMLElement>('[data-conversation-scroll]')
  if (scroller === null) return null
  const box = scroller.getBoundingClientRect()
  for (const row of scroller.querySelectorAll<HTMLElement>('[data-chat-anchor-key]')) {
    const rect = row.getBoundingClientRect()
    if (rect.bottom < box.top) continue
    const key = row.dataset.chatAnchorKey
    if (key !== undefined) return { key, top: rect.top }
  }
  return null
}

function restoreReaderAnchor(document: Document, anchor: ReaderAnchor | null): void {
  if (anchor === null) return
  const view = document.defaultView ?? globalThis.window
  view.requestAnimationFrame(() => {
    view.requestAnimationFrame(() => {
      const scroller = document.querySelector<HTMLElement>('[data-conversation-scroll]')
      const row = Array.from(document.querySelectorAll<HTMLElement>('[data-chat-anchor-key]'))
        .find(candidate => candidate.dataset.chatAnchorKey === anchor.key)
      if (scroller === null || row === undefined) return
      scroller.scrollTop += row.getBoundingClientRect().top - anchor.top
    })
  })
}

function sessionsFrom(ctx: SessionsContext): SessionsLike | undefined {
  let value: unknown
  try { value = ctx.get?.('sessions', false) ?? ctx.sessions } catch { return undefined }
  if (value === null || typeof value !== 'object') return undefined
  const candidate = value as Partial<SessionsLike>
  if (candidate.list === undefined || typeof candidate.binding !== 'function') return undefined
  return candidate as SessionsLike
}

/** Subscribe to every session opened during this app lifetime; restore only while it is current. */
export function installHistoryContinuityAdapter(ctx: SessionsContext, document: Document = globalThis.document): () => void {
  const sessions = sessionsFrom(ctx)
  if (sessions === undefined) return () => {}
  const disposers = new Map<string, () => void>()
  const attachedSessions = new Map<string, ObservableSession>()
  const ledgers = new Map<string, ExpandedHistoryLedger>()
  let disposed = false

  const current = (): string | undefined => sessions.list.getSnapshot().current
  const attach = (id: string): void => {
    const session = sessions.binding(id)?.session
    if (session === undefined) return
    if (attachedSessions.get(id) === session) return
    disposers.get(id)?.()
    disposers.delete(id)
    ledgers.delete(id)
    attachedSessions.set(id, session)
    const ledger = new ExpandedHistoryLedger(() => session.loadOlder())
    ledgers.set(id, ledger)
    ledger.observe(readingOf(session))
    const onSnapshot = (): void => {
      if (sessions.binding(id)?.session !== session || attachedSessions.get(id) !== session) {
        attach(id)
        return
      }
      const reading = readingOf(session)
      ledger.observe(reading)
      if (disposed || current() !== id || ledger.boundary === null || reading.firstSeq === null || reading.firstSeq <= ledger.boundary) return
      const anchor = captureReaderAnchor(document)
      queueMicrotask(() => {
        void ledger.restoreIfNeeded(
          () => readingOf(session),
          () => !disposed && current() === id && attachedSessions.get(id) === session && sessions.binding(id)?.session === session,
        ).then(() => { if (!disposed && current() === id && attachedSessions.get(id) === session && sessions.binding(id)?.session === session) restoreReaderAnchor(document, anchor) })
      })
    }
    disposers.set(id, session.subscribe(onSnapshot))
  }
  const onList = (): void => {
    const id = current()
    if (id === undefined) return
    attach(id)
    const session = sessions.binding(id)?.session
    const ledger = ledgers.get(id)
    if (session === undefined || ledger === undefined) return
    const reading = readingOf(session)
    ledger.observe(reading)
    if (ledger.boundary !== null && reading.firstSeq !== null && reading.firstSeq > ledger.boundary) {
      const anchor = captureReaderAnchor(document)
      void ledger.restoreIfNeeded(
          () => readingOf(session),
          () => !disposed && current() === id && attachedSessions.get(id) === session && sessions.binding(id)?.session === session,
        ).then(() => { if (!disposed && current() === id && attachedSessions.get(id) === session && sessions.binding(id)?.session === session) restoreReaderAnchor(document, anchor) })
    }
  }
  const disposeList = sessions.list.subscribe(onList)
  onList()
  return () => {
    disposed = true
    disposeList()
    for (const dispose of disposers.values()) dispose()
    disposers.clear()
    attachedSessions.clear()
    ledgers.clear()
  }
}
