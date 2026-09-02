/** Mobile repair for an unroutable default on the active Host. */

interface ModelSelectionLike {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

interface ModelCatalogModelLike {
  readonly id: string
  readonly reasoning?: {
    readonly efforts: readonly { readonly id: string }[]
  }
}

interface ModelProviderGroupLike {
  readonly id: string
  readonly models: readonly ModelCatalogModelLike[]
}

interface ModelDirectoryStateLike {
  readonly current: ModelSelectionLike | null
  readonly routable: boolean | null
  readonly groups: readonly ModelProviderGroupLike[]
}

interface ModelDirectoryLike {
  load(): Promise<ModelDirectoryStateLike>
  select(selection: ModelSelectionLike): Promise<void>
}

interface SessionSummaryLike {
  readonly id: string
  readonly blank: boolean
}

interface SessionListSnapshotLike {
  readonly current?: string
  readonly byId: Readonly<Record<string, SessionSummaryLike | undefined>>
}

export interface HostModelFallbackContext {
  readonly sessions: {
    readonly list: {
      getSnapshot(): SessionListSnapshotLike
      subscribe(listener: () => void): () => void
    }
  }
  readonly modelDirectories: {
    directoryFor(sessionId: string): ModelDirectoryLike
  }
}

function selectionFor(
  provider: string,
  model: ModelCatalogModelLike,
  current: ModelSelectionLike,
): ModelSelectionLike {
  const effort = current.reasoningEffort
  const preservesEffort = effort !== undefined
    && model.reasoning?.efforts.some(candidate => candidate.id === effort) === true
  return {
    provider,
    model: model.id,
    ...(preservesEffort ? { reasoningEffort: effort } : {}),
  }
}

/**
 * Choose a routable replacement from one Host's advertised catalog.
 * @param state - Unroutable selection and the current Host provider groups.
 * @returns A unique same-model route, otherwise the first advertised route.
 */
export function hostModelFallback(state: {
  readonly current: ModelSelectionLike
  readonly groups: readonly ModelProviderGroupLike[]
}): ModelSelectionLike | undefined {
  const sameModel = state.groups.flatMap(group => group.models
    .filter(model => model.id === state.current.model)
    .map(model => ({ provider: group.id, model })))
  if (sameModel.length === 1) {
    return selectionFor(sameModel[0].provider, sameModel[0].model, state.current)
  }
  const firstGroup = state.groups.find(group => group.models.length > 0)
  const firstModel = firstGroup?.models[0]
  return firstGroup === undefined || firstModel === undefined
    ? undefined
    : selectionFor(firstGroup.id, firstModel, state.current)
}

/**
 * Repair only the selected blank Session when its Host reports the current
 * provider route missing. Existing conversation history remains untouched.
 * @param ctx - Mobile client Session list and model-directory service.
 * @returns Disposer for the Session-list subscription.
 */
export function installHostModelFallbackAdapter(ctx: HostModelFallbackContext): () => void {
  const attempted = new Set<string>()
  let disposed = false

  const repair = async (sessionId: string): Promise<void> => {
    try {
      const directory = ctx.modelDirectories.directoryFor(sessionId)
      const state = await directory.load()
      if (disposed) return
      const snapshot = ctx.sessions.list.getSnapshot()
      if (snapshot.current !== sessionId || snapshot.byId[sessionId]?.blank !== true) {
        attempted.delete(sessionId)
        return
      }
      if (state.routable !== false || state.current === null) return
      const fallback = hostModelFallback({ current: state.current, groups: state.groups })
      if (fallback === undefined) {
        attempted.delete(sessionId)
        return
      }
      await directory.select(fallback)
    } catch {
      // A later Session-list notification retries after connection or catalog recovery.
      attempted.delete(sessionId)
    }
  }

  const inspect = (): void => {
    const snapshot = ctx.sessions.list.getSnapshot()
    const sessionId = snapshot.current
    if (sessionId === undefined || snapshot.byId[sessionId]?.blank !== true || attempted.has(sessionId)) return
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
