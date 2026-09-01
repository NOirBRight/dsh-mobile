/** Mobile recovery for blank sessions created before Agent Presets were enabled. */

interface SessionSummaryLike {
  readonly id: string
  readonly blank: boolean
  readonly projectionValues?: Readonly<Record<string, unknown>>
}

interface SessionListSnapshotLike {
  readonly current?: string
  readonly byId: Readonly<Record<string, SessionSummaryLike | undefined>>
}

interface AgentPresetRemoteLike {
  list(): Promise<{
    readonly ok: boolean
    readonly value?: {
      readonly presets: readonly { readonly id: string; readonly isDefault: boolean }[]
    }
  }>
  select(sessionId: string, agentPreset: string): Promise<{ readonly ok: boolean }>
}

export interface LegacyBlankPresetContext {
  readonly sessions: {
    readonly list: {
      getSnapshot(): SessionListSnapshotLike
      subscribe(listener: () => void): () => void
    }
  }
  readonly remote: { readonly agentPresets: AgentPresetRemoteLike }
}

function needsPreset(session: SessionSummaryLike | undefined): session is SessionSummaryLike {
  return session?.blank === true && typeof session.projectionValues?.agentPreset !== 'string'
}

/**
 * Assign the Host default to a reused legacy blank whose summary carries no
 * Agent Preset. The official hero picker hides while that projection is
 * absent; making the implied default explicit lets the same official picker
 * render and still switch presets before the first turn.
 * @param ctx - mobile client session list and Agent Preset Remote.
 * @returns disposer for the session-list subscription.
 */
export function installLegacyBlankPresetAdapter(ctx: LegacyBlankPresetContext): () => void {
  const attempted = new Set<string>()
  let disposed = false

  const repair = async (sessionId: string): Promise<void> => {
    try {
      const roster = await ctx.remote.agentPresets.list()
      if (!roster.ok || roster.value === undefined) {
        attempted.delete(sessionId)
        return
      }
      const preset = roster.value.presets.find(candidate => candidate.isDefault)
        ?? roster.value.presets[0]
      if (preset === undefined || disposed) return

      const snapshot = ctx.sessions.list.getSnapshot()
      if (snapshot.current !== sessionId || !needsPreset(snapshot.byId[sessionId])) {
        attempted.delete(sessionId)
        return
      }
      const selected = await ctx.remote.agentPresets.select(sessionId, preset.id)
      if (!selected.ok) attempted.delete(sessionId)
    } catch {
      // A connection reset or later list update is the retry signal.
      attempted.delete(sessionId)
    }
  }

  const inspect = (): void => {
    const snapshot = ctx.sessions.list.getSnapshot()
    const sessionId = snapshot.current
    if (sessionId === undefined || !needsPreset(snapshot.byId[sessionId]) || attempted.has(sessionId)) return
    attempted.add(sessionId)
    void repair(sessionId)
  }

  const unsubscribe = ctx.sessions.list.subscribe(inspect)
  inspect()
  return () => {
    disposed = true
    unsubscribe()
  }
}
