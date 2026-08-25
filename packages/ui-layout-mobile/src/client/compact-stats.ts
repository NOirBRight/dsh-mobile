/** Compact StatsLine copy. Pure: no React, no cordis. */

export interface SessionStatsReading {
  turns: number
  steps: number
  llmMs: number
  toolMs: number
  ttftMs: number
  ttftSteps: number
  decodeMs: number
  decodeTokens: number
}

export interface TokenUsageReading {
  uncachedInputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
}

export interface ContextPressureReading {
  projectedTokens?: number
  pressureTokens?: number
  contextWindow?: number
}

export interface CompactStatsCopy {
  main: string
}

export function formatTokens(n: number): string {
  const scaled = (v: number): string =>
    v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10)
  if (n < 1_000) return String(n)
  if (n < 1_000_000) return `${scaled(n / 1_000)}K`
  return `${scaled(n / 1_000_000)}M`
}

export function formatDuration(ms: number): string {
  const s = ms / 1_000
  if (s < 60) return `${Math.round(s * 10) / 10}s`
  const whole = Math.round(s)
  return `${Math.floor(whole / 60)}m${whole % 60}s`
}

export function formatTokensPerSecond(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return ''
  const scaled = n >= 100 ? String(Math.round(n)) : String(Math.round(n * 10) / 10)
  return `${scaled} tok/s`
}

export function billedInputTokens(usage: TokenUsageReading): number {
  return usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
}

export function contextOccupancy(pressure: ContextPressureReading | undefined): {
  percent: number
  usedTokens: number
  contextWindow: number
} | null {
  const usedTokens = pressure?.projectedTokens ?? pressure?.pressureTokens
  if (usedTokens === undefined || pressure?.contextWindow === undefined || pressure.contextWindow <= 0) {
    return null
  }
  return {
    percent: Math.min(100, Math.round(usedTokens / pressure.contextWindow * 100)),
    usedTokens,
    contextWindow: pressure.contextWindow,
  }
}

export function asSessionStats(value: unknown): SessionStatsReading | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const row = value as Record<string, unknown>
  if (typeof row.turns !== 'number' || typeof row.steps !== 'number') return undefined
  return {
    turns: row.turns,
    steps: row.steps,
    llmMs: typeof row.llmMs === 'number' ? row.llmMs : 0,
    toolMs: typeof row.toolMs === 'number' ? row.toolMs : 0,
    ttftMs: typeof row.ttftMs === 'number' ? row.ttftMs : 0,
    ttftSteps: typeof row.ttftSteps === 'number' ? row.ttftSteps : 0,
    decodeMs: typeof row.decodeMs === 'number' ? row.decodeMs : 0,
    decodeTokens: typeof row.decodeTokens === 'number' ? row.decodeTokens : 0,
  }
}

export function asTokenUsage(value: unknown): TokenUsageReading | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const row = value as Record<string, unknown>
  if (
    typeof row.uncachedInputTokens !== 'number'
    || typeof row.cacheReadTokens !== 'number'
    || typeof row.cacheWriteTokens !== 'number'
    || typeof row.outputTokens !== 'number'
  ) return undefined
  return {
    uncachedInputTokens: row.uncachedInputTokens,
    cacheReadTokens: row.cacheReadTokens,
    cacheWriteTokens: row.cacheWriteTokens,
    outputTokens: row.outputTokens,
  }
}

export function asContextPressure(value: unknown): ContextPressureReading | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const row = value as Record<string, unknown>
  const pressure: ContextPressureReading = {}
  if (typeof row.projectedTokens === 'number') pressure.projectedTokens = row.projectedTokens
  if (typeof row.pressureTokens === 'number') pressure.pressureTokens = row.pressureTokens
  if (typeof row.contextWindow === 'number') pressure.contextWindow = row.contextWindow
  return pressure
}

export function compactStatsCopy(
  stats: SessionStatsReading | undefined,
  usage: TokenUsageReading | undefined,
  _pressure: ContextPressureReading | undefined,
  locale = 'zh-CN',
): CompactStatsCopy | null {
  const parts: string[] = []
  if (stats !== undefined && stats.ttftSteps > 0) {
    parts.push(`TTFT ${formatDuration(stats.ttftMs / stats.ttftSteps)}`)
  }
  if (stats !== undefined && stats.decodeMs > 0) {
    const throughput = formatTokensPerSecond(stats.decodeTokens / (stats.decodeMs / 1_000))
    if (throughput !== '') parts.push(throughput)
  }
  if (usage !== undefined && billedInputTokens(usage) > 0) {
    const eligible = usage.uncachedInputTokens + usage.cacheReadTokens
    const hitRate = eligible > 0 ? Math.round(usage.cacheReadTokens / eligible * 100) : 0
    const cacheLabel = locale.toLowerCase().startsWith('zh') ? '缓存命中率' : 'Cache hit'
    parts.push(`${cacheLabel} ${hitRate}%`)
  }
  if (usage !== undefined && (billedInputTokens(usage) > 0 || usage.outputTokens > 0)) {
    parts.push(`↑${formatTokens(billedInputTokens(usage))} ↓${formatTokens(usage.outputTokens)}`)
  }
  return parts.length === 0 ? null : { main: parts.join(' · ') }
}
