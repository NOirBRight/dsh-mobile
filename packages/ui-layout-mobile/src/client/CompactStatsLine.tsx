/** Narrow composer stats dock. Replaces official StatsLine via the same occupant id. */

import {
  asContextPressure,
  asSessionStats,
  asTokenUsage,
  compactStatsCopy,
} from './compact-stats.ts'
import css from './CompactStatsLine.module.css'

export interface CompactStatsLineProps {
  useProjection: (key: string) => unknown
}

export function CompactStatsLine({ useProjection }: CompactStatsLineProps) {
  const copy = compactStatsCopy(
    asSessionStats(useProjection('sessionStats')),
    asTokenUsage(useProjection('tokenUsage')),
    asContextPressure(useProjection('contextPressure')),
    document.documentElement.lang,
  )
  if (copy === null) return null
  return <div className={css.root}><span className={css.main}>{copy.main}</span></div>
}
