/** Narrow composer stats dock. Replaces official StatsLine via the same occupant id. */

import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// The stats dock reads session projection keys merged by the owning domain
// client modules; re-merge them type-only so the keys are valid on
// SessionProjectionMap.
import type {} from '@deepseek-ai/dsh-session-stats/client'
import type {} from '@deepseek-ai/dsh-token-meter/client'
import {
  asContextPressure,
  asSessionStats,
  asTokenUsage,
  compactStatsCopy,
} from './compact-stats.ts'
import css from './CompactStatsLine.module.css'

export type CompactStatsLineProps = PropsRuntime<'conversation.composer.dock'>

export function CompactStatsLine({ useProjection }: CompactStatsLineProps) {
  const copy = compactStatsCopy(
    asSessionStats(useProjection('sessionStats', value => value)),
    asTokenUsage(useProjection('tokenUsage', value => value)),
    asContextPressure(useProjection('contextPressure', value => value)),
    document.documentElement.lang,
  )
  if (copy === null) return null
  return <div className={css.root}><span className={css.main}>{copy.main}</span></div>
}
