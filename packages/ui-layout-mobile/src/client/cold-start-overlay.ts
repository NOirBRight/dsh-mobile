/** Read-only session overlay: observe official stores, persist durable cache, cover seats. */

import { composerCardSendSeat } from './composer-attach.ts'
import { coldStartPresentation, type BaselineState } from './cold-start-presentation.ts'
import {
  createIndexedDbSessionCache,
  createMemorySessionRecordStore,
  createSessionCache,
  normalizeListEntry,
  type SessionCache,
  type SessionListCacheEntry,
  type SessionWindowCacheSeed,
} from './session-cache.ts'

export interface ColdStartBaselineDetail {
  generation: number
  listBaseline: BaselineState
  windowBaseline: BaselineState
  hasListSnapshot: boolean
  hasWindowSnapshot: boolean
}

export interface ColdStartOverlayModel {
  listOverlay: boolean
  conversationOverlay: boolean
  composerLocked: boolean
  listRows: readonly SessionListCacheEntry[]
  windowEntries: readonly { event: Record<string, unknown> }[]
  windowHasMore: boolean
  hasListSnapshot: boolean
  hasWindowSnapshot: boolean
  currentSessionId?: string
}

interface ObservableLike<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

interface SessionBindingLike {
  session: ObservableLike<{ openState?: string }>
  eventSource: ObservableLike<{
    entries?: readonly unknown[]
    hasMore?: unknown
    revision?: unknown
    change?: { kind?: unknown }
  }>
}

interface SessionListSnapshotLike {
  phase?: 'pending' | 'ready'
  ids?: readonly string[]
  current?: string
  byId?: Readonly<Record<string, unknown>>
}

interface SessionsLike {
  list: ObservableLike<SessionListSnapshotLike>
  binding(id: string): SessionBindingLike | undefined
  open(id: string): void
  refresh(): Promise<void>
}

export interface ColdStartOverlayControllerOptions {
  sessions: SessionsLike
  cache: SessionCache
  createCache?: (hostId: string) => SessionCache
  hostId: string
  generation: number
  onBaseline?: (detail: ColdStartBaselineDetail) => void
  onChange?: (model: ColdStartOverlayModel) => void
}

export interface ColdStartOverlayController {
  dispose(): void
  snapshot(): ColdStartOverlayModel
  requestOpen(sessionId: string): void
  handleTransport(detail: { hostId: string; generation: number }): void
  handleRetry(): Promise<void>
}

interface SessionsContext {
  get?(name: string, strict?: boolean): unknown
  sessions?: unknown
}

function sessionsFrom(ctx: SessionsContext): SessionsLike | undefined {
  let value: unknown
  try { value = ctx.get?.('sessions', false) ?? ctx.sessions } catch { return undefined }
  if (value === null || typeof value !== 'object') return undefined
  const candidate = value as Partial<SessionsLike>
  if (candidate.list === undefined || typeof candidate.binding !== 'function' || typeof candidate.open !== 'function') {
    return undefined
  }
  const refresh = typeof candidate.refresh === 'function' ? candidate.refresh.bind(candidate) : async () => {}
  return {
    list: candidate.list,
    binding: candidate.binding.bind(candidate),
    open: candidate.open.bind(candidate),
    refresh,
  }
}

function present(input: {
  listBaseline: BaselineState
  windowBaseline: BaselineState
  hasListSnapshot: boolean
  hasWindowSnapshot: boolean
}): Pick<ColdStartOverlayModel, 'listOverlay' | 'conversationOverlay' | 'composerLocked'> {
  const view = coldStartPresentation({
    status: 'open',
    shellMounted: true,
    liveDataReady: 'pending',
    accountsOwnBaselines: true,
    listBaseline: input.listBaseline,
    windowBaseline: input.windowBaseline,
    hasListSnapshot: input.hasListSnapshot,
    hasWindowSnapshot: input.hasWindowSnapshot,
  })
  return {
    listOverlay: view.listOverlay,
    conversationOverlay: view.conversationOverlay,
    composerLocked: view.composerLocked,
  }
}

function eventText(event: Record<string, unknown>): string {
  const data = event.data
  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    const text = (data as { text?: unknown }).text
    if (typeof text === 'string' && text.trim() !== '') return text
  }
  return typeof event.type === 'string' ? event.type : ''
}

/** Observe official list/window stores, keep one Host-partitioned cache, and expose overlay model. */
export function createColdStartOverlayController(options: ColdStartOverlayControllerOptions): ColdStartOverlayController {
  const sessions = options.sessions
  let cache = options.cache
  let hostId = options.hostId
  let generation = options.generation
  let listBaseline: BaselineState = 'pending'
  let windowBaseline: BaselineState = 'pending'
  let hasListSnapshot = false
  let hasWindowSnapshot = false
  let listRows: SessionListCacheEntry[] = []
  let windowSeed: { sessionId: string; window: SessionWindowCacheSeed } | undefined
  let acceptLive = true
  let queuedOpen: string | undefined
  let epoch = 0
  let disposed = false
  let loadSerial = 0
  let windowUnsub: (() => void) | undefined
  const unsubscribers: (() => void)[] = []

  const model = (): ColdStartOverlayModel => {
    const flags = present({ listBaseline, windowBaseline, hasListSnapshot, hasWindowSnapshot })
    return {
      ...flags,
      listRows,
      windowEntries: windowSeed?.window.entries ?? [],
      windowHasMore: windowSeed?.window.hasMore === true,
      hasListSnapshot,
      hasWindowSnapshot,
      currentSessionId: windowSeed?.sessionId,
    }
  }

  const publish = (): void => {
    if (disposed) return
    const next = model()
    options.onBaseline?.({
      generation,
      listBaseline,
      windowBaseline,
      hasListSnapshot,
      hasWindowSnapshot,
    })
    options.onChange?.(next)
  }

  const applyCache = (
    list: readonly SessionListCacheEntry[] | undefined,
    window: { sessionId: string; window: SessionWindowCacheSeed } | undefined,
  ): void => {
    hasListSnapshot = list !== undefined
    listRows = list === undefined ? [] : [...list]
    hasWindowSnapshot = window !== undefined
    windowSeed = window
  }

  const reloadCache = async (): Promise<void> => {
    const serial = ++loadSerial
    const reading = cache
    let list: readonly SessionListCacheEntry[] | undefined
    let window: { sessionId: string; window: SessionWindowCacheSeed } | undefined
    try { list = await reading.readList() } catch { list = undefined }
    try { window = await reading.readWindow() } catch { window = undefined }
    if (disposed || serial !== loadSerial || cache !== reading) return
    applyCache(list, window)
  }

  const detachWindow = (): void => {
    windowUnsub?.()
    windowUnsub = undefined
  }

  const commitWindow = (sessionId: string, snapshot: ReturnType<SessionBindingLike['eventSource']['getSnapshot']>, kind: 'baseline' | 'tail'): void => {
    if (kind === 'tail' && snapshot.change?.kind === 'prepend') return
    const seed = {
      entries: Array.isArray(snapshot.entries) ? snapshot.entries : [],
      hasMore: snapshot.hasMore === true,
    }
    windowSeed = { sessionId, window: { entries: [], hasMore: seed.hasMore } }
    void cache.writeWindow(sessionId, seed).then(async () => {
      const stored = await cache.readWindow()
      if (disposed) return
      if (stored !== undefined) {
        windowSeed = stored
        hasWindowSnapshot = true
        publish()
      }
    })
    hasWindowSnapshot = true
  }

  const inspectWindow = (sessionId: string, myEpoch: number): void => {
    if (disposed || myEpoch !== epoch) return
    const binding = sessions.binding(sessionId)
    if (binding === undefined) return
    const openState = binding.session.getSnapshot().openState
    if (openState === 'open') {
      windowBaseline = 'ready'
      commitWindow(sessionId, binding.eventSource.getSnapshot(), 'baseline')
      return
    }
    if (openState === 'error') {
      windowBaseline = 'error'
      return
    }
    windowBaseline = 'pending'
  }

  const attachWindow = (sessionId: string): void => {
    detachWindow()
    const myEpoch = epoch
    const binding = sessions.binding(sessionId)
    if (binding === undefined) return
    const onWindow = (): void => {
      if (disposed || myEpoch !== epoch || !acceptLive) return
      const openState = binding.session.getSnapshot().openState
      if (openState === 'open') {
        const alreadyReady = windowBaseline === 'ready'
        windowBaseline = 'ready'
        commitWindow(sessionId, binding.eventSource.getSnapshot(), alreadyReady ? 'tail' : 'baseline')
        publish()
        return
      }
      if (openState === 'error') {
        windowBaseline = 'error'
        publish()
      }
    }
    const offSession = binding.session.subscribe(onWindow)
    const offEvents = binding.eventSource.subscribe(onWindow)
    windowUnsub = () => {
      offSession()
      offEvents()
    }
    if (acceptLive) inspectWindow(sessionId, myEpoch)
  }

  const liveIds = (snapshot: SessionListSnapshotLike): readonly string[] =>
    Array.isArray(snapshot.ids) ? snapshot.ids : []

  const flushOpen = (snapshot: SessionListSnapshotLike): void => {
    const id = queuedOpen
    if (id === undefined || snapshot.phase !== 'ready') return
    queuedOpen = undefined
    if (!liveIds(snapshot).includes(id)) return
    try { sessions.open(id) } catch { /* never open a missing id */ }
  }

  const inspectList = (): void => {
    if (disposed || !acceptLive) return
    const snapshot = sessions.list.getSnapshot()
    if (snapshot.phase !== 'ready') {
      listBaseline = 'pending'
      return
    }
    listBaseline = 'ready'
    const ids = liveIds(snapshot)
    const entries = ids.flatMap(id => {
      const row = snapshot.byId?.[id]
      return row === undefined ? [] : [row]
    })
    const normalized = ids.length === 0
      ? []
      : entries.flatMap(row => {
        const next = normalizeListEntry(row)
        return next === undefined ? [] : [next]
      })
    listRows = normalized
    hasListSnapshot = true
    void cache.writeList(normalized)
    const current = snapshot.current
    if (typeof current !== 'string' || current.length === 0 || !ids.includes(current)) {
      windowBaseline = 'ready'
      detachWindow()
    } else {
      if (windowBaseline === 'ready' || windowBaseline === 'error') {
        /* keep until this generation's session reports */
      }
      if (windowBaseline !== 'ready') windowBaseline = windowBaseline === 'error' ? 'error' : 'pending'
      attachWindow(current)
    }
    flushOpen(snapshot)
  }

  const resetLive = (): void => {
    epoch += 1
    acceptLive = false
    listBaseline = 'pending'
    windowBaseline = 'pending'
    detachWindow()
  }

  const inspect = (): void => {
    inspectList()
    publish()
  }

  unsubscribers.push(sessions.list.subscribe(() => {
    acceptLive = true
    inspect()
  }))

  const boot = (): void => {
    void reloadCache().then(() => {
      if (disposed) return
      if (acceptLive) inspectList()
      publish()
    })
  }
  boot()

  return {
    dispose() {
      if (disposed) return
      disposed = true
      detachWindow()
      for (const off of unsubscribers) off()
      unsubscribers.length = 0
    },
    snapshot: () => model(),
    requestOpen(sessionId) {
      if (disposed || typeof sessionId !== 'string' || sessionId.length === 0) return
      const snapshot = sessions.list.getSnapshot()
      if (snapshot.phase !== 'ready') {
        queuedOpen = sessionId
        return
      }
      queuedOpen = undefined
      if (!liveIds(snapshot).includes(sessionId)) return
      try { sessions.open(sessionId) } catch { /* missing ids stay closed */ }
    },
    handleTransport(detail) {
      if (disposed) return
      generation = detail.generation
      if (detail.hostId !== '' && detail.hostId !== hostId) {
        hostId = detail.hostId
        if (options.createCache !== undefined) cache = options.createCache(hostId)
      }
      resetLive()
      queuedOpen = undefined
      void reloadCache().then(() => {
        if (disposed) return
        publish()
      })
    },
    async handleRetry() {
      if (disposed) return
      if (windowBaseline === 'error') windowBaseline = 'pending'
      acceptLive = true
      publish()
      try { await sessions.refresh() } catch { /* next snapshot is the retry signal */ }
      if (disposed) return
      const snapshot = sessions.list.getSnapshot()
      const current = snapshot.current
      if (typeof current === 'string' && liveIds(snapshot).includes(current)) {
        try { sessions.open(current) } catch { /* gone between refresh and open */ }
      }
      inspect()
    },
  }
}

function ensureOverlay(host: Element, attr: string, document: Document): HTMLElement {
  const existing = host.querySelector<HTMLElement>(':scope > [' + attr + ']')
  if (existing !== null) return existing
  const node = document.createElement('div')
  node.setAttribute(attr, '')
  node.setAttribute('hidden', '')
  host.append(node)
  return node
}

function paintList(overlay: HTMLElement, model: ColdStartOverlayModel, onOpen: (id: string) => void): void {
  overlay.toggleAttribute('hidden', !model.listOverlay)
  overlay.replaceChildren()
  if (!model.listOverlay) return
  overlay.setAttribute('data-mobile-cold-start-empty', model.listRows.length === 0 ? '' : 'false')
  for (const row of model.listRows) {
    const button = overlay.ownerDocument.createElement('button')
    button.type = 'button'
    button.dataset.mobileColdStartSessionId = row.sessionId
    button.textContent = row.title ?? row.sessionId
    button.addEventListener('click', () => { onOpen(row.sessionId) })
    overlay.append(button)
  }
}

function paintConversation(overlay: HTMLElement, model: ColdStartOverlayModel): void {
  overlay.toggleAttribute('hidden', !model.conversationOverlay)
  overlay.replaceChildren()
  if (!model.conversationOverlay) return
  for (const entry of model.windowEntries) {
    const line = overlay.ownerDocument.createElement('div')
    line.dataset.mobileColdStartEvent = ''
    line.textContent = eventText(entry.event)
    overlay.append(line)
  }
}

function paintOverlays(document: Document, model: ColdStartOverlayModel, onOpen: (id: string) => void): void {
  const drawer = document.querySelector('nav[aria-label="导航抽屉"]')
  const chat = document.querySelector('[data-chat-scroll]')
  const main = document.querySelector('main')
  const conversationHost = chat ?? main
  if (drawer !== null && drawer.closest('[data-shell-overlay]') === null) {
    paintList(ensureOverlay(drawer, 'data-mobile-cold-start-list-overlay', document), model, onOpen)
  }
  if (conversationHost !== null && conversationHost.closest('[data-shell-overlay]') === null) {
    paintConversation(ensureOverlay(conversationHost, 'data-mobile-cold-start-conversation-overlay', document), model)
  }
}

function installComposerLock(document: Document, locked: () => boolean): () => void {
  const guard = (event: Event): void => {
    if (!locked()) return
    const target = event.target
    if (!(typeof Element === 'function') || !(target instanceof Element)) return
    const card = target.closest('[data-composer-card]')
    if (!(card instanceof HTMLElement)) return
    if (event.type === 'keydown') {
      const key = (event as KeyboardEvent).key
      if (key !== 'Enter' || (event as KeyboardEvent).shiftKey || (event as KeyboardEvent).isComposing) return
      event.preventDefault()
      event.stopPropagation()
      return
    }
    const send = composerCardSendSeat(card)
    if (send === null) return
    if (send === target || send.contains(target)) {
      event.preventDefault()
      event.stopPropagation()
    }
  }
  document.addEventListener('pointerdown', guard, true)
  document.addEventListener('click', guard, true)
  document.addEventListener('keydown', guard, true)
  return () => {
    document.removeEventListener('pointerdown', guard, true)
    document.removeEventListener('click', guard, true)
    document.removeEventListener('keydown', guard, true)
  }
}

function readTransport(document: Document): { hostId: string; generation: number } {
  const hostId = document.documentElement.dataset.dshMobileHostId ?? ''
  const generation = Number(document.documentElement.dataset.dshMobileConnectionGeneration)
  return {
    hostId,
    generation: Number.isFinite(generation) && generation > 0 ? generation : 0,
  }
}

export interface InstallColdStartOverlayOptions {
  document?: Document
  cache?: SessionCache
  createCache?: (hostId: string) => SessionCache
}

function cacheFor(hostId: string, options: InstallColdStartOverlayOptions): SessionCache {
  if (options.cache !== undefined) return options.cache
  if (options.createCache !== undefined) return options.createCache(hostId)
  return createIndexedDbSessionCache(hostId) ?? createSessionCache(hostId, createMemorySessionRecordStore())
}

/**
 * Cover official sidebar (inside the drawer) and conversation while this
 * connection generation's list/window baselines are pending. Codex keeps the
 * shell overlay seat.
 */
export function installColdStartOverlayAdapter(
  ctx: SessionsContext,
  options: InstallColdStartOverlayOptions = {},
): () => void {
  const document = options.document ?? globalThis.document
  if (document === undefined) return () => {}
  const sessions = sessionsFrom(ctx)
  if (sessions === undefined) return () => {}

  const transport = readTransport(document)
  const createCache = (hostId: string): SessionCache => cacheFor(hostId, options)
  let controller!: ColdStartOverlayController
  let observing = false
  let observer: MutationObserver | undefined
  if (typeof MutationObserver === 'function') {
    observer = new MutationObserver(() => {
      if (!observing) return
      observing = false
      observer?.disconnect()
      paintOverlays(document, controller.snapshot(), id => { controller.requestOpen(id) })
      observer?.observe(document.documentElement ?? document.body, { childList: true, subtree: true })
      observing = true
    })
  }
  const render = (model: ColdStartOverlayModel): void => {
    observing = false
    observer?.disconnect()
    paintOverlays(document, model, id => { controller.requestOpen(id) })
    observer?.observe(document.documentElement ?? document.body, { childList: true, subtree: true })
    observing = observer !== undefined
  }
  controller = createColdStartOverlayController({
    sessions,
    cache: createCache(transport.hostId),
    createCache,
    hostId: transport.hostId,
    generation: transport.generation,
    onBaseline(detail) {
      if (typeof CustomEvent !== 'function') return
      document.dispatchEvent(new CustomEvent('dsh-mobile:cold-start-baseline', { detail }))
    },
    onChange: render,
  })
  render(controller.snapshot())
  const unlock = installComposerLock(document, () => controller.snapshot().composerLocked)

  const onTransport = (event: Event): void => {
    const detail = (event as CustomEvent<{ hostId?: unknown; generation?: unknown }>).detail
    const hostId = typeof detail?.hostId === 'string' ? detail.hostId : readTransport(document).hostId
    const generation = typeof detail?.generation === 'number' ? detail.generation : readTransport(document).generation
    controller.handleTransport({ hostId, generation })
  }
  const onRetry = (): void => { void controller.handleRetry() }
  document.addEventListener('dsh-mobile:cold-start-transport', onTransport)
  document.addEventListener('dsh-mobile:cold-start-retry', onRetry)

  return () => {
    observing = false
    observer?.disconnect()
    document.removeEventListener('dsh-mobile:cold-start-transport', onTransport)
    document.removeEventListener('dsh-mobile:cold-start-retry', onRetry)
    unlock()
    controller.dispose()
  }
}
