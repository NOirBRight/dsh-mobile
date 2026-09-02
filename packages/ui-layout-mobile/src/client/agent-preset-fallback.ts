/** Mobile recovery for a Host that did not mount the official preset seat. */

interface PresetOption {
  readonly id: string
  readonly name?: string
  readonly description?: string
  readonly isDefault?: boolean
}

interface PresetRoster {
  readonly presets: readonly PresetOption[]
}

interface PresetResult<T> {
  readonly ok: boolean
  readonly value?: T
  readonly error?: { readonly message?: string }
}

type RawPresetResult<T> = PresetResult<T> | { readonly result: PresetResult<T> }

export interface AgentPresetFallbackRemote {
  list(...args: readonly [] | readonly [{}]): Promise<RawPresetResult<PresetRoster>>
  select(...args: readonly [string, string] | readonly [{ readonly sessionId: string; readonly agentPreset: string }]): Promise<RawPresetResult<unknown>>
}

interface SessionSummary {
  readonly id: string
  readonly blank: boolean
  readonly agentPreset?: string
}

export interface AgentPresetFallbackContext {
  readonly remote: { readonly agentPresets: AgentPresetFallbackRemote }
  readonly sessions: {
    readonly list: {
      getSnapshot(): { readonly current?: string; readonly byId: Record<string, SessionSummary | undefined> }
      subscribe(listener: () => void): () => void
    }
  }
}

const BUILT_IN_LABELS: Readonly<Record<string, string>> = {
  standard: 'Standard mode',
  ptc: 'PTC mode',
  minimal: 'Minimal mode',
  cordis: 'Creator mode',
}

/** Resolve a compact mobile label without hiding custom preset names. */
export function mobilePresetLabel(option: PresetOption): string {
  return option.name?.trim() || BUILT_IN_LABELS[option.id] || option.id
}

/** Return only empty official Hero preset slots that need a mobile fallback. */
export function findEmptyAgentPresetSlots(root: ParentNode = document): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('[data-slot="conversation.hero.agentPreset"]')]
    .filter(slot => slot.querySelector('button[aria-haspopup="menu"]') === null)
}

function unwrapResult<T>(raw: RawPresetResult<T>): PresetResult<T> {
  return 'result' in raw ? raw.result : raw
}

function resultValue<T>(raw: RawPresetResult<T>): T | undefined {
  const result = unwrapResult(raw)
  return result.ok ? result.value : undefined
}

const SHIPPED_ALPHA4_PRESETS: PresetOption[] = [
  { id: 'standard', isDefault: true },
  { id: 'ptc' },
  { id: 'minimal' },
  { id: 'cordis' },
]

function rosterValue(raw: RawPresetResult<PresetRoster>): PresetRoster | undefined {
  const value = resultValue(raw) as PresetRoster | readonly PresetOption[] | undefined
  if (Array.isArray(value)) return { presets: value }
  if (value !== undefined && typeof value === 'object' && !Array.isArray(value) && 'presets' in value) {
    const presets = Reflect.get(value, 'presets')
    if (Array.isArray(presets)) return { presets }
  }
  return undefined
}

function currentBlankSession(ctx: AgentPresetFallbackContext): SessionSummary | undefined {
  const snapshot = ctx.sessions.list.getSnapshot()
  const id = snapshot.current
  const session = id === undefined ? undefined : snapshot.byId[id]
  return session?.blank === true ? session : undefined
}

function clearMenu(menu: HTMLElement): void {
  menu.replaceChildren()
  menu.hidden = true
}

function positionMenu(menu: HTMLElement, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect()
  menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 248))}px`
  menu.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - 12)}px`
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: number | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error('Agent preset roster timed out')), milliseconds)
      }),
    ])
  } finally {
    if (timer !== undefined) window.clearTimeout(timer)
  }
}

function iconSvg(path: string, viewBox = '0 0 16 16'): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', viewBox === '0 0 14 14' ? '14' : '16')
  svg.setAttribute('height', viewBox === '0 0 14 14' ? '14' : '16')
  svg.setAttribute('viewBox', viewBox)
  svg.setAttribute('fill', 'none')
  svg.setAttribute('aria-hidden', 'true')
  svg.innerHTML = path
  return svg
}

const PRESET_ICON = '<path d="M8 2.1a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Zm-4.5 7.7a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Zm9 0a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4ZM7.5 4.9 4.4 9.8m4.1-4.9 3.1 4.9" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/>'
const CHEVRON_ICON = '<path d="m3 5 3.15 3.15c.5.5 1.2.5 1.7 0L11 5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>'

function mountSlot(ctx: AgentPresetFallbackContext, slot: HTMLElement): () => void {
  const anchor = document.createElement('button')
  anchor.type = 'button'
  anchor.dataset.mobileAgentPresetFallback = ''
  anchor.dataset.officialAgentPresetStyle = ''
  anchor.setAttribute('aria-haspopup', 'menu')
  anchor.setAttribute('aria-expanded', 'false')
  anchor.append(iconSvg(PRESET_ICON), document.createTextNode(''), iconSvg(CHEVRON_ICON, '0 0 14 14'))
  anchor.firstElementChild?.classList.add('mobileAgentPresetIcon')
  anchor.lastElementChild?.classList.add('mobileAgentPresetChevron')

  const menu = document.createElement('div')
  menu.dataset.mobileAgentPresetMenu = ''
  menu.setAttribute('role', 'menu')
  menu.hidden = true
  document.body.append(menu)
  slot.append(anchor)

  let options: readonly PresetOption[] = []
  let selected = 'standard'
  let staged: string | undefined
  let disposed = false

  const close = (): void => {
    anchor.setAttribute('aria-expanded', 'false')
    clearMenu(menu)
  }
  const render = (): void => {
    const option = options.find(item => item.id === selected)
    const label = option === undefined ? '' : mobilePresetLabel(option)
    const icon = anchor.querySelector('.mobileAgentPresetIcon')
    const chevron = anchor.querySelector('.mobileAgentPresetChevron')
    anchor.replaceChildren(
      ...(icon === null ? [iconSvg(PRESET_ICON)] : [icon]),
      document.createTextNode(label),
      ...(chevron === null ? [iconSvg(CHEVRON_ICON, '0 0 14 14')] : [chevron]),
    )
    anchor.querySelector('.mobileAgentPresetIcon')?.classList.add('mobileAgentPresetIcon')
    anchor.querySelector('.mobileAgentPresetChevron')?.classList.add('mobileAgentPresetChevron')
    anchor.setAttribute('title', option?.description ?? '选择新会话模式')
  }
  const apply = async (): Promise<void> => {
    if (staged === undefined) return
    const session = currentBlankSession(ctx)
    if (session === undefined) return
    const target = staged
    const first = unwrapResult(await ctx.remote.agentPresets.select(session.id, target))
    const result = first.ok ? first : unwrapResult(await ctx.remote.agentPresets.select({ sessionId: session.id, agentPreset: target }))
    if (disposed) return
    if (result.ok) {
      selected = target
      staged = undefined
      render()
    } else {
      anchor.title = result.error?.message ?? '模式切换失败'
    }
  }
  const open = (): void => {
    if (options.length === 0) return
    menu.replaceChildren(...options.map(option => {
      const item = document.createElement('button')
      item.type = 'button'
      item.dataset.mobileAgentPresetOption = option.id
      item.setAttribute('role', 'menuitem')
      item.textContent = mobilePresetLabel(option)
      if (option.description !== undefined) item.title = option.description
      item.addEventListener('click', () => {
        selected = option.id
        staged = option.id
        render()
        close()
        void apply()
      })
      return item
    }))
    positionMenu(menu, anchor)
    menu.hidden = false
    anchor.setAttribute('aria-expanded', 'true')
  }
  anchor.addEventListener('click', () => {
    if (menu.hidden) open()
    else close()
  })
  const onDocumentClick = (event: Event): void => {
    if (event.target instanceof Node && (menu.contains(event.target) || anchor.contains(event.target))) return
    close()
  }
  document.addEventListener('click', onDocumentClick)
  const unsubscribe = ctx.sessions.list.subscribe(() => { void apply() })

  // The shipped Alpha.4 roster is stable. Paint it immediately so a slow or
  // unavailable optional remote cannot leave the official chip blank; a live
  // roster response replaces it below when the bridge is ready.
  options = SHIPPED_ALPHA4_PRESETS
  render()

  void (async (): Promise<RawPresetResult<PresetRoster>> => {
    try {
      // Generated Alpha.4 remotes take no arguments. Calling the old object
      // form first can leave a mobile bridge request pending indefinitely.
      return await withTimeout(ctx.remote.agentPresets.list(), 2_000)
    } catch {
      return withTimeout(ctx.remote.agentPresets.list({}), 2_000)
    }
  })().then(raw => {
    if (disposed) return
    const result = unwrapResult(raw)
    const roster = rosterValue(raw)
    // Alpha.4 ships these four presets. The mobile bridge can come up before
    // the optional remote roster mount; keep the official chip usable while
    // it catches up, and let the Host reject an unavailable choice loudly.
    options = roster?.presets.length === 0 || roster === undefined
      ? SHIPPED_ALPHA4_PRESETS
      : roster.presets
    if (roster === undefined) anchor.title = result.error?.message ?? 'Agent preset roster is loading'
    selected = options.find(option => option.isDefault)?.id ?? options[0].id
    const session = currentBlankSession(ctx)
    if (session?.agentPreset !== undefined) selected = session.agentPreset
    render()
    void apply()
  }).catch(error => {
    if (!disposed) anchor.title = error instanceof Error ? error.message : '模式加载失败'
  })

  return () => {
    disposed = true
    unsubscribe()
    document.removeEventListener('click', onDocumentClick)
    clearMenu(menu)
    menu.remove()
    anchor.remove()
  }
}

/** Mount one fallback per empty official slot and retract it when the Host seat appears. */
export function installAgentPresetFallback(ctx: AgentPresetFallbackContext, root: ParentNode = document): () => void {
  const mounted = new Map<HTMLElement, () => void>()
  const scan = (): void => {
    for (const slot of findEmptyAgentPresetSlots(root)) {
      if (!mounted.has(slot)) mounted.set(slot, mountSlot(ctx, slot))
    }
    for (const [slot, dispose] of mounted) {
      if (!slot.isConnected || slot.querySelector('button[aria-haspopup="menu"]:not([data-mobile-agent-preset-fallback])') !== null) {
        dispose()
        mounted.delete(slot)
      }
    }
  }
  const observer = new MutationObserver(scan)
  observer.observe(root, { subtree: true, childList: true })
  scan()
  return () => {
    observer.disconnect()
    for (const dispose of mounted.values()) dispose()
    mounted.clear()
  }
}
