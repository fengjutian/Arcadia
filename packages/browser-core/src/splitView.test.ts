import { describe, expect, it } from 'vitest'
import { SPLIT_MIN_WIDTH, splitBounds } from './splitView'

const rect = { x: 100, y: 50, width: 1200, height: 800 }

describe('splitBounds', () => {
  it('returns null below the minimum width', () => {
    expect(splitBounds({ ...rect, width: SPLIT_MIN_WIDTH - 1 })).toBeNull()
    expect(splitBounds({ ...rect, width: Number.NaN })).toBeNull()
  })

  it('splits into two panes that cover the original rect', () => {
    const result = splitBounds(rect)
    expect(result).not.toBeNull()
    expect(result!.left.x).toBe(100)
    expect(result!.left.width + result!.right.width).toBe(rect.width)
    expect(result!.right.x).toBe(100 + rect.width - result!.right.width)
    expect(result!.left.height).toBe(800)
    expect(result!.right.y).toBe(50)
  })

  it('never lets a pane drop below 320px', () => {
    const result = splitBounds({ ...rect, width: SPLIT_MIN_WIDTH })
    expect(result!.left.width).toBeGreaterThanOrEqual(320)
    expect(result!.right.width).toBeGreaterThanOrEqual(320)
  })

  it('respects the drag ratio and leaves a gap for the divider', () => {
    const result = splitBounds(rect, 0.65, 8)
    expect(result!.left.width).toBeGreaterThan(result!.right.width)
    expect(result!.right.x).toBe(rect.x + Math.round(rect.width * 0.65) + 4)
    // 8px gap stays uncovered between the panes.
    expect(result!.left.width + result!.right.width).toBe(rect.width - 8)
  })

  it('clamps extreme ratios back into the readable range', () => {
    const result = splitBounds(rect, 0.95)
    expect(result!.left.width).toBe(Math.round(rect.width * 0.7))
  })
})
