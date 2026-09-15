/**
 * Official 0.1.6 MenuView renders `icon` as a string kind or a component
 * `{ size: 16 }`. Built-in Host command faces already carry glyphs; wrapping
 * that source or stamping every `command-` row replaces them with the cube.
 * Only the `/` skill source is wrapped. Icon-less plugin command rows (ponytail)
 * get the cube from the DOM presenter after Host has committed its own SVG.
 */
import { createElement, type ComponentType } from 'react'

/** Size/className face 0.1.6 MenuView uses when rendering a candidate icon component. */
export interface SkillCubeIconProps {
  size?: number
  className?: string
}

const CUBE_OUTLINE = 'M8 1.75 13.75 5v6L8 14.25 2.25 11V5L8 1.75Z'
const CUBE_SEAMS = 'M2.25 5 8 8.25 13.75 5M8 8.25v6'

/**
 * Isometric cube matching the Codex-style skill chip.
 * @param props - MenuView passes size 16.
 */
export function SkillCubeIcon({ size = 16, className }: SkillCubeIconProps) {
  return createElement(
    'svg',
    { width: size, height: size, className, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
    createElement('path', { d: 'M8 1.75 13.75 5 8 8.25 2.25 5Z', fill: 'currentColor', opacity: 0.22 }),
    createElement('path', { d: 'M8 8.25 13.75 5v6L8 14.25Z', fill: 'currentColor', opacity: 0.12 }),
    createElement('path', {
      d: CUBE_OUTLINE,
      stroke: 'currentColor',
      strokeWidth: 1.2,
      strokeLinejoin: 'round',
    }),
    createElement('path', {
      d: CUBE_SEAMS,
      stroke: 'currentColor',
      strokeWidth: 1.2,
      strokeLinejoin: 'round',
    }),
  )
}

const DECORATED = Symbol.for('dsh-mobile.slash-menu-icon')

/** Marker on a DOM-injected cube so a later scan does not double-stamp. */
export const MENU_ICON_MARKER = 'data-mobile-menu-icon'

/** One `/` trigger source, the subset this decorator writes. */
export interface SlashTriggerSource {
  readonly trigger: string
  readonly name: string
  candidates: (...args: unknown[]) => Promise<readonly SlashMenuCandidate[]>
}

/** Candidate row; only `icon` is written when missing. */
export interface SlashMenuCandidate {
  readonly name: string
  icon?: string | ComponentType<SkillCubeIconProps>
}

/** `ctx.inputTriggers` fields this installer needs. */
export interface InputTriggerRegistry {
  registerSource(src: SlashTriggerSource): () => void
  live?: { sources: SlashTriggerSource[] }
}

/**
 * Copy a candidate and attach {@link SkillCubeIcon} when it has no icon.
 * @param row - one `/` menu candidate.
 * @returns the same row, or a copy with the cube icon.
 */
export function withDefaultSlashIcon<T extends SlashMenuCandidate>(row: T): T {
  if (row.icon !== undefined) return row
  return { ...row, icon: SkillCubeIcon } as T
}

/**
 * Patch one `/` skill source so later candidate passes carry the cube.
 * The Host `command` source is left alone: its faces already own glyphs.
 * Idempotent.
 * @param src - a registered trigger source.
 * @returns the same source object.
 */
export function decorateSlashSource<T extends SlashTriggerSource>(src: T): T {
  if (src.trigger !== '/' || src.name === 'command') return src
  const marked = src as T & { [DECORATED]?: true }
  if (marked[DECORATED] === true) return src
  const inner = src.candidates.bind(src)
  src.candidates = async (...args: unknown[]) => {
    const rows = await inner(...args)
    return rows.map(row => withDefaultSlashIcon(row))
  }
  marked[DECORATED] = true
  return src
}

/**
 * Wrap future `/` source registrations and decorate any source already live.
 * @param service - `ctx.inputTriggers`.
 * @returns disposer that restores `registerSource`.
 */
export function installSlashMenuIcon(service: InputTriggerRegistry): () => void {
  const original = service.registerSource.bind(service)
  service.registerSource = src => original(decorateSlashSource(src))
  for (const src of service.live?.sources ?? []) decorateSlashSource(src)
  return () => {
    service.registerSource = original
  }
}

const SLASH_OPTION = '[data-trigger-menu] [role="option"], [data-composer-card] [role="listbox"] [role="option"]'

function cubeSeat(option: HTMLElement): Element | null {
  return option.querySelector('[' + MENU_ICON_MARKER + ']')
}

/**
 * True when MenuView already put a glyph on the row. Our injected cube is
 * ignored so a late Host SVG can reclaim the seat.
 * @param option - a slash listbox option.
 */
export function hasOfficialMenuGlyph(option: HTMLElement): boolean {
  for (const svg of option.querySelectorAll('svg')) {
    if (svg.closest('[' + MENU_ICON_MARKER + ']') === null) return true
  }
  return false
}

function appendCubeSvg(svg: SVGSVGElement, d: string, extra: Record<string, string>): void {
  const path = svg.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', d)
  for (const [name, value] of Object.entries(extra)) path.setAttribute(name, value)
  svg.append(path)
}

/**
 * Build the cube SVG used by the DOM fallback.
 * @param doc - owner document.
 */
export function createSkillCubeSvg(doc: Document): SVGSVGElement {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', '16')
  svg.setAttribute('height', '16')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('aria-hidden', 'true')
  appendCubeSvg(svg, 'M8 1.75 13.75 5 8 8.25 2.25 5Z', { fill: 'currentColor', opacity: '0.22' })
  appendCubeSvg(svg, 'M8 8.25 13.75 5v6L8 14.25Z', { fill: 'currentColor', opacity: '0.12' })
  appendCubeSvg(svg, CUBE_OUTLINE, { stroke: 'currentColor', 'stroke-width': '1.2', 'stroke-linejoin': 'round' })
  appendCubeSvg(svg, CUBE_SEAMS, { stroke: 'currentColor', 'stroke-width': '1.2', 'stroke-linejoin': 'round' })
  return svg
}

/**
 * Prepend the cube into one icon-less slash option. Removes a stale cube when
 * Host later commits its own glyph (the plus-menu race).
 * @param option - a `[role="option"]` under `[data-trigger-menu]`.
 */
export function stampSlashOptionIcon(option: HTMLElement): void {
  if (hasOfficialMenuGlyph(option)) {
    cubeSeat(option)?.remove()
    return
  }
  if (cubeSeat(option) !== null) return
  const seat = option.ownerDocument.createElement('span')
  seat.setAttribute(MENU_ICON_MARKER, '')
  seat.setAttribute('aria-hidden', 'true')
  seat.append(createSkillCubeSvg(option.ownerDocument))
  option.prepend(seat)
}

/**
 * Watch slash menus and stamp the cube on every option that still has no SVG.
 * @param document - owner document.
 * @returns disposer that removes injected seats.
 */
export function installSlashMenuIconPresenter(document: Document = globalThis.document): () => void {
  if (typeof document === 'undefined' || document.documentElement === null) return () => {}
  if (typeof MutationObserver !== 'function') return () => {}
  const view = document.defaultView ?? globalThis.window
  const stamped = new Set<HTMLElement>()
  let frame = 0
  const scan = (): void => {
    const live = new Set<HTMLElement>()
    for (const option of document.querySelectorAll<HTMLElement>(SLASH_OPTION)) {
      stampSlashOptionIcon(option)
      if (option.querySelector('[' + MENU_ICON_MARKER + ']') !== null) {
        live.add(option)
        stamped.add(option)
      }
    }
    for (const option of stamped) {
      if (live.has(option)) continue
      option.querySelector('[' + MENU_ICON_MARKER + ']')?.remove()
      stamped.delete(option)
    }
  }
  const runFrame = (): void => { frame = 0; scan() }
  const schedule = (): void => { if (frame === 0) frame = view.requestAnimationFrame(runFrame) }
  const observer = new MutationObserver(() => {
    scan()
    schedule()
  })
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['aria-expanded', 'aria-activedescendant'],
  })
  scan()
  return () => {
    observer.disconnect()
    if (frame !== 0) view.cancelAnimationFrame(frame)
    for (const option of stamped) option.querySelector('[' + MENU_ICON_MARKER + ']')?.remove()
    stamped.clear()
  }
}
