/**
 * Explicit recovery exception: a hung plugin graph cannot be safely reused.
 * Call only after a user profile action has persisted its next selection.
 * Healthy device changes continue through the resident HostSession.
 */
export function reloadStalledBoot(painting: boolean, recoveryRequested: boolean): boolean {
  if (!painting && !recoveryRequested) return false
  window.location.reload()
  return true
}
