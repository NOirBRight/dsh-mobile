/** Small presentation seam shared by first-run and device-switch scan surfaces. */
export interface ScanSurface {
  /** Show scanner progress, or wait for the user to retry after a rejected code. */
  show(message: string, retryLabel?: string): void | Promise<void>
}
