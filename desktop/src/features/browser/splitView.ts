/**
 * Split-view geometry. Native webviews are positioned with absolute bounds, so
 * the layout math lives in a pure function and is unit-tested separately from
 * the browser component.
 */

export interface SplitRect {
  x: number
  y: number
  width: number
  height: number
}

/** Below this width the two panes would be too narrow to read. */
export const SPLIT_MIN_WIDTH = 900
const MIN_PANE_WIDTH = 320

export function splitBounds(rect: SplitRect): { left: SplitRect; right: SplitRect } | null {
  if (!Number.isFinite(rect.width) || rect.width < SPLIT_MIN_WIDTH) return null
  const rightWidth = Math.max(MIN_PANE_WIDTH, Math.floor(rect.width / 2))
  if (rect.width - rightWidth < MIN_PANE_WIDTH) return null
  return {
    left: { ...rect, width: rect.width - rightWidth },
    right: { ...rect, x: rect.x + rect.width - rightWidth, width: rightWidth },
  }
}
