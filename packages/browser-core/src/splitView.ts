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
export const MIN_SPLIT_RATIO = 0.3
export const MAX_SPLIT_RATIO = 0.7

export function splitBounds(rect: SplitRect, ratio = 0.5, gap = 0): { left: SplitRect; right: SplitRect } | null {
  if (!Number.isFinite(rect.width) || rect.width < SPLIT_MIN_WIDTH) return null
  const clamped = Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, Number.isFinite(ratio) ? ratio : 0.5))
  const splitAt = Math.round(rect.width * clamped)
  const safeGap = Math.max(0, Math.round(gap))
  const leftWidth = splitAt - Math.floor(safeGap / 2)
  const rightWidth = rect.width - splitAt - Math.ceil(safeGap / 2)
  if (leftWidth < MIN_PANE_WIDTH || rightWidth < MIN_PANE_WIDTH) return null
  return {
    left: { ...rect, width: leftWidth },
    right: { ...rect, x: rect.x + splitAt + Math.ceil(safeGap / 2), width: rightWidth },
  }
}
