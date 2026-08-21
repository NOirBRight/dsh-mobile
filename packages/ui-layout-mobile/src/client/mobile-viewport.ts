/** Resolve the shell height from the visible visual viewport without growing it. */
export function resolveMobileViewportHeight(layoutHeight: number, visualViewportHeight: number | undefined): number {
  const layout = Number.isFinite(layoutHeight) && layoutHeight > 0 ? layoutHeight : 0
  const visual = visualViewportHeight !== undefined && Number.isFinite(visualViewportHeight) && visualViewportHeight > 0
    ? visualViewportHeight
    : 0
  if (layout === 0) return visual
  if (visual === 0) return layout
  return Math.min(layout, visual)
}
