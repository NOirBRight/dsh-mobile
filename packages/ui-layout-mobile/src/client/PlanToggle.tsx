/** Always-visible plan-mode icon. Click runs /plan, click again runs /plan off. */

import { useEffect, useRef, useState } from 'react'
import {
  asPlan,
  planClickCommand,
  planTarget,
  planToggleAria,
  planToggleDisabled,
  type PlanCommand,
} from './plan-toggle.ts'
import css from './PlanToggle.module.css'

export interface PlanToggleProps {
  locked: boolean
  useProjection: (key: string) => unknown
  runPlanCommand: (line: PlanCommand) => Promise<string | null>
}

function ListTodoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="4" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="2" />
      <path d="m3 17 2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13 5h8M13 12h8M13 19h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export function PlanToggle({ locked, useProjection, runPlanCommand }: PlanToggleProps) {
  const plan = asPlan(useProjection('plan'))
  const [leaving, setLeaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])

  if (plan === undefined) return null
  const on = planTarget(plan)
  const aria = planToggleAria(on, document.documentElement.lang)

  const toggle = (): void => {
    setLeaving(true)
    setError(null)
    void runPlanCommand(planClickCommand(plan)).then((failure) => {
      if (!aliveRef.current) return
      setLeaving(false)
      setError(failure)
    }, (reason: unknown) => {
      if (!aliveRef.current) return
      setLeaving(false)
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  return (
    <button
      type="button"
      className={`${css.toggle}${on ? ` ${css.on}` : ''}`}
      data-mobile-plan-toggle
      aria-pressed={on}
      aria-label={aria}
      title={error ?? aria}
      disabled={planToggleDisabled(locked, leaving)}
      onClick={toggle}
    >
      <ListTodoIcon />
    </button>
  )
}
