/** Seeded copy of alpha.2 `isDarwinDesktop` for the 0.1.5 primitives table. */

/**
 * Whether the client runs in the macOS desktop shell: the Electron preload
 * marks `<html>` with `data-platform="darwin"`; plain web never sets it.
 * @returns true only inside the macOS Electron shell.
 */
export function isDarwinDesktop(): boolean {
  return document.documentElement.dataset.platform === 'darwin'
}
