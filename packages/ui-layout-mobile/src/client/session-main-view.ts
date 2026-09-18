/** Session list occupancy used after Alpha.2 dropped `SessionListState.current`. */

/** Occupancy facts Alpha.2 uses instead of `SessionListState.current`. */
export interface MainViewRetention {
  readonly mainView?: number
}

/** Host session row plus the occupancy field this helper reads. */
export type WithMainViewRetention<T> = T & {
  readonly retainedBy?: MainViewRetention
}

/**
 * Session list facts needed to recover the former `current` selection.
 * Host `SessionListState` is a compile-target duck type; callers pass their
 * row type so they do not re-declare `retainedBy.mainView`.
 */
export interface SessionListMainViewState<TRow = unknown> {
  readonly current?: string
  readonly byId: Readonly<Record<string, WithMainViewRetention<TRow> | undefined>>
}

function mainViewCount(row: WithMainViewRetention<unknown> | undefined): number {
  return row?.retainedBy?.mainView ?? 0
}

/**
 * Return the Session occupying the main view.
 *
 * Alpha.2 dropped `SessionListState.current`. Occupancy is a positive
 * `retainedBy.mainView` count. `current` remains a fallback for Alpha.1
 * snapshots and older fixtures.
 */
export function mainViewSessionId<TRow>(state: SessionListMainViewState<TRow>): string | undefined {
  for (const [id, row] of Object.entries(state.byId)) {
    if (mainViewCount(row) > 0) return id
  }
  return state.current
}
