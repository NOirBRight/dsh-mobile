/** Session list facts needed to recover the former `current` selection. */
export interface SessionListMainViewState {
  readonly current?: string
  readonly byId?: object
}

function mainViewCount(row: unknown): number {
  if (row === null || typeof row !== 'object') return 0
  const retainedBy = (row as { retainedBy?: { mainView?: number } }).retainedBy
  return retainedBy?.mainView ?? 0
}

/**
 * Return the Session occupying the main view.
 *
 * Alpha.2 dropped `SessionListState.current`. Occupancy is a positive
 * `retainedBy.mainView` count. `current` remains a fallback for Alpha.1
 * snapshots and older fixtures.
 */
export function mainViewSessionId(state: SessionListMainViewState): string | undefined {
  for (const [id, row] of Object.entries(state.byId ?? {})) {
    if (mainViewCount(row) > 0) return id
  }
  return state.current
}
