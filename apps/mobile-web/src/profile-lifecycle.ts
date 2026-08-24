export interface HostProfileActivation<T> {
  setActive(hostId: T): Promise<void>
  reconnect(): Promise<void>
}

/** Resolve only after the selected Host is both durable and handed to the live connection. */
export async function activateHostProfile<T>(hostId: T, activation: HostProfileActivation<T>): Promise<void> {
  await activation.setActive(hostId)
  await activation.reconnect()
}

export interface HostProfileSwitchTarget<T> {
  hostId: T
  displayName: string
}

export interface HostProfileSwitchSurface {
  showConnecting(displayName: string): void
  showError(message: string): void
  close(): void
}

/** Keep visible switch feedback mounted until the selected Host has connected and painted. */
export async function runHostProfileSwitch<T>(
  target: HostProfileSwitchTarget<T>,
  activate: (hostId: T) => Promise<void>,
  surface: HostProfileSwitchSurface,
): Promise<boolean> {
  surface.showConnecting(target.displayName)
  try {
    await activate(target.hostId)
    surface.close()
    return true
  } catch (error) {
    surface.showError(error instanceof Error ? error.message : String(error))
    return false
  }
}

export interface ProfileOnboardingSurface {
  waitForScan(): Promise<void>
  show(message: string): void | Promise<void>
  showError(message: string): void
  destroy(): void
}

export interface ProfileOnboardingOptions<T> {
  surface: ProfileOnboardingSurface
  initialError?: string
  scan(): Promise<string>
  prepare(offerUrl: string): Promise<T>
}

/** Keep the formal Onboarding surface in control until one valid Active Host is prepared. */
export async function completeProfileOnboarding<T>(options: ProfileOnboardingOptions<T>): Promise<T> {
  if (options.initialError !== undefined) options.surface.showError(options.initialError)
  while (true) {
    await options.surface.waitForScan()
    const offerUrl = await options.scan()
    await options.surface.show('二维码已识别，正在保存 Host Profile…')
    try {
      const prepared = await options.prepare(offerUrl)
      options.surface.destroy()
      return prepared
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error'
      options.surface.showError('配对失败：' + reason + '。请检查二维码后重试')
    }
  }
}

export interface HostProfileRemoval<T> {
  remove(hostId: T): Promise<void>
  count(): Promise<number>
  reconnect(): Promise<void>
  onboarding(): Promise<void>
}

/** Remove one Host and complete the resulting stay/reconnect/Onboarding transition. */
export async function removeHostProfile<T>(
  hostId: T,
  activeHostId: T | undefined,
  removal: HostProfileRemoval<T>,
): Promise<ProfileRemovalTransition> {
  await removal.remove(hostId)
  const transition = profileRemovalTransition({
    removedActive: hostId === activeHostId,
    remainingProfiles: await removal.count(),
  })
  if (transition === 'onboarding') await removal.onboarding()
  else if (transition === 'reconnect') await removal.reconnect()
  return transition
}

export type ProfileRemovalTransition = 'stay' | 'reconnect' | 'onboarding'

export interface ProfileRemovalResult {
  removedActive: boolean
  remainingProfiles: number
}

/** Map repository removal facts to exactly one Product Client lifecycle transition. */
export function profileRemovalTransition(result: ProfileRemovalResult): ProfileRemovalTransition {
  if (result.remainingProfiles === 0) return 'onboarding'
  return result.removedActive ? 'reconnect' : 'stay'
}
