import { describe, expect, it } from 'vitest'
import { tallestToastStack, toastStackCssValue } from './toastStack'

describe('tallestToastStack', () => {
  it('reserves nothing while no holder reports a stack', () => {
    expect(tallestToastStack([])).toBe(0)
    expect(toastStackCssValue(0)).toBeNull()
  })

  it('keeps the tallest of several simultaneous holders', () => {
    expect(tallestToastStack([0, 44, 92, 12])).toBe(92)
  })

  it('ignores heights that are not finite and never returns a negative shelf', () => {
    expect(tallestToastStack([Number.NaN, Number.POSITIVE_INFINITY, -20, 40])).toBe(40)
    expect(tallestToastStack([Number.NaN, -8])).toBe(0)
  })

  it('rounds fractional measurements up so a toast is never clipped', () => {
    expect(tallestToastStack([43.2])).toBe(44)
    expect(toastStackCssValue(43.2)).toBe('44px')
  })

  it('publishes a pixel value only for a non-empty stack', () => {
    expect(toastStackCssValue(92)).toBe('92px')
    expect(toastStackCssValue(-1)).toBeNull()
  })
})
