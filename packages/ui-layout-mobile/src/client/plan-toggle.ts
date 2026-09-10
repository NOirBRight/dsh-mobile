/** Plan-mode icon toggle: host projection fold + /plan command lines. */

export interface PlanProjection {
  readonly active: boolean
  readonly pending: boolean
}

export type PlanCommand = '/plan' | '/plan off'

/** Effective plan target: a pending flip is already the next state. */
export function planTarget(plan: PlanProjection): boolean {
  return plan.pending ? !plan.active : plan.active
}

export function planCommand(on: boolean): PlanCommand {
  return on ? '/plan' : '/plan off'
}

/** Opposite of the folded target. Queued enter (active false, pending true) is `/plan off`. */
export function planClickCommand(plan: PlanProjection): PlanCommand {
  return planCommand(!planTarget(plan))
}

/** Official chip: locked || leaving. Host pending is a queued flip, not an RPC lock. */
export function planToggleDisabled(locked: boolean, rpcInFlight: boolean): boolean {
  return locked || rpcInFlight
}

export function asPlan(value: unknown): PlanProjection | undefined {
  if (value === null || value === undefined || typeof value !== 'object') return undefined
  const rec = value as { active?: unknown; pending?: unknown }
  if (typeof rec.active !== 'boolean' || typeof rec.pending !== 'boolean') return undefined
  return { active: rec.active, pending: rec.pending }
}

export function planToggleAria(on: boolean, lang: string): string {
  const zh = lang.toLowerCase().startsWith('zh')
  if (on) return zh ? 'plan mode 已开启，按下关闭' : 'Plan mode on, press to turn off'
  return zh ? 'plan mode 已关闭，按下开启' : 'Plan mode off, press to turn on'
}

export function interpretPlanCommandResult(line: PlanCommand, result: unknown): string | null {
  if (result === null || typeof result !== 'object') return 'unknown command: ' + line
  const rec = result as { ok?: unknown; value?: unknown; error?: { message?: unknown; code?: unknown } }
  if (rec.ok === false) {
    const message = typeof rec.error?.message === 'string' ? rec.error.message : 'failed'
    const code = typeof rec.error?.code === 'string' ? rec.error.code : 'unknown'
    return message + ' (' + code + ')'
  }
  if (rec.ok === true && rec.value === undefined) return 'unknown command: ' + line
  return null
}

interface CommandsExecute {
  (sessionId: string, line: string, images: readonly unknown[]): Promise<unknown>
}

export function commandsExecuteFrom(holder: unknown): CommandsExecute | undefined {
  if (holder === null || typeof holder !== 'object') return undefined
  const ctx = holder as {
    get?(name: string, strict?: boolean): unknown
    remote?: { commands?: { execute?: unknown } }
  }
  let value: unknown
  try { value = ctx.get?.('remote.commands', false) ?? ctx.remote?.commands } catch { return undefined }
  if (value === null || typeof value !== 'object') return undefined
  const execute = (value as { execute?: unknown }).execute
  return typeof execute === 'function' ? execute as CommandsExecute : undefined
}
