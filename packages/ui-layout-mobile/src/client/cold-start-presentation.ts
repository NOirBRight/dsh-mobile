/**
 * Shared cold-start presentation. Chip copy, list/conversation overlays, and
 * composer lock are one state machine so the shell badge and layout overlay
 * cannot disagree. Pure: no React, cordis, or Capacitor.
 */

export type ChipVisibleText = '连接中…' | '重连中…' | '同步中…' | '同步失败'
export type BaselineState = 'pending' | 'ready' | 'error'
export type ColdStartLiveDataReady = boolean | 'pending' | 'ready' | 'error' | 'core-ready'

export type ColdStartTunnelState = 'connecting' | 'open' | 'closed'

export type ColdStartTunnelActivity =
  | { phase: 'connecting'; attempt: number; reconnecting: boolean; route?: 'direct' | 'tunnel' | null }
  | { phase: 'retry-wait'; attempt: number; retryInMs?: number; route?: 'direct' | 'tunnel' | null; error?: string }
  | { phase: 'open'; attempt: number; route?: 'direct' | 'tunnel' | null }
  | { phase: 'terminal'; attempt: number; route?: 'direct' | 'tunnel' | null; error: string }

export type ColdStartStatus = ColdStartTunnelState | ColdStartTunnelActivity

export interface ColdStartPresentationInput {
  status: ColdStartStatus
  route?: string
  shellMounted: boolean
  /** Official contract when dataset.dshLiveDataReadiness === 'v1'. */
  liveDataReady: ColdStartLiveDataReady
  accountsOwnBaselines: boolean
  listBaseline: BaselineState
  windowBaseline: BaselineState
  hasListSnapshot: boolean
  hasWindowSnapshot: boolean
}

export interface ColdStartChip {
  visible: boolean
  text: string
  label: string
  color: string
}

export interface ColdStartPresentation {
  chip: ColdStartChip
  listOverlay: boolean
  conversationOverlay: boolean
  composerLocked: boolean
}

const COLOR_ERROR = 'var(--dsw-alias-state-error-primary, #ec1313)'
const COLOR_WARN = 'var(--dsw-alias-state-warn-primary, #f59e0b)'
const COLOR_OK = 'var(--dsw-alias-state-success-primary, #22c55e)'

const CONNECTING_CHIP: ReadonlySet<string> = new Set(['连接中…', '重连中…', '同步中…', '同步失败'])

function titled(route: string, title: string): string {
  return route === '' ? title : route + ' · ' + title
}

function normalizeReadiness(liveDataReady: ColdStartLiveDataReady): Exclude<ColdStartLiveDataReady, boolean> {
  if (liveDataReady === true) return 'ready'
  if (liveDataReady === false) return 'pending'
  return liveDataReady
}

function tunnelState(status: ColdStartStatus): ColdStartTunnelState {
  if (typeof status === 'string') return status
  if (status.phase === 'open') return 'open'
  if (status.phase === 'connecting') return 'connecting'
  return 'closed'
}

function isPassiveRetry(status: ColdStartStatus): boolean {
  return typeof status !== 'string'
    && (status.phase === 'retry-wait'
      || (status.phase === 'connecting' && status.reconnecting && status.attempt >= 3))
}

function overlayOn(baseline: BaselineState, hasSnapshot: boolean): boolean {
  return baseline === 'pending' || (baseline === 'error' && hasSnapshot)
}

function presentChip(input: ColdStartPresentationInput): ColdStartChip {
  const route = input.route ?? ''
  if (typeof input.status !== 'string' && input.status.phase === 'terminal') {
    return {
      visible: false,
      text: '离线',
      label: titled(route, '连接需要处理'),
      color: COLOR_ERROR,
    }
  }
  if (isPassiveRetry(input.status)) {
    return {
      visible: input.shellMounted,
      text: '重连中…',
      label: titled(route, '连接中断，后台自动重试'),
      color: COLOR_WARN,
    }
  }
  const state = tunnelState(input.status)
  const reconnecting = typeof input.status !== 'string'
    && input.status.phase === 'connecting'
    && input.status.reconnecting
  const readiness = normalizeReadiness(input.liveDataReady)
  const officialReady = readiness === 'ready'
  const ownReady = input.accountsOwnBaselines
    && input.listBaseline === 'ready'
    && input.windowBaseline === 'ready'
  const sessionReady = officialReady || ownReady
  const syncFailed = state === 'open' && !sessionReady
    && (readiness === 'error' || input.listBaseline === 'error' || input.windowBaseline === 'error')
  const syncing = state === 'open' && !sessionReady && !syncFailed
  const connected = state === 'open' && sessionReady
  const title = syncFailed
    ? '会话数据同步失败'
    : syncing
      ? '正在同步会话…'
      : connected
        ? '已连接'
        : state === 'connecting'
          ? reconnecting ? '正在重连…' : '隧道连接中…'
          : '隧道已断开，重连中'
  const color = state === 'closed' || syncFailed
    ? COLOR_ERROR
    : connected
      ? COLOR_OK
      : COLOR_WARN
  const text = syncFailed
    ? '同步失败'
    : syncing
      ? '同步中…'
      : connected
        ? '已连接'
        : state === 'connecting'
          ? reconnecting ? '重连中…' : '连接中…'
          : '重连中…'
  return {
    visible: input.shellMounted && !connected,
    text,
    label: titled(route, title),
    color,
  }
}

/** Single product seam for the floating chip, overlays, and composer lock. */
export function coldStartPresentation(input: ColdStartPresentationInput): ColdStartPresentation {
  const chip = presentChip(input)
  const listOverlay = overlayOn(input.listBaseline, input.hasListSnapshot)
  const conversationOverlay = overlayOn(input.windowBaseline, input.hasWindowSnapshot)
  const composerLocked = listOverlay || conversationOverlay || CONNECTING_CHIP.has(chip.text)
  return { chip, listOverlay, conversationOverlay, composerLocked }
}
