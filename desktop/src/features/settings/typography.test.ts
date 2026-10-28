import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_TYPOGRAPHY_SETTINGS,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  TYPOGRAPHY_CHANGE_EVENT,
  TYPOGRAPHY_FONTS,
  TYPOGRAPHY_STORAGE_KEY,
  applyTypographySettings,
  clampTypographyFontSize,
  readTypographySettings,
  typographyFont,
  writeTypographySettings,
} from './typography'

describe('typography settings', () => {
  beforeEach(() => {
    localStorage.removeItem(TYPOGRAPHY_STORAGE_KEY)
    document.documentElement.removeAttribute('data-typography-font')
    document.documentElement.style.removeProperty('--font-ui')
    document.documentElement.style.removeProperty('--font-reading')
    document.documentElement.style.removeProperty('--reading-font-size')
  })
  afterEach(() => localStorage.removeItem(TYPOGRAPHY_STORAGE_KEY))

  it('defaults to the open-source serif face at 18px', () => {
    expect(readTypographySettings()).toEqual(DEFAULT_TYPOGRAPHY_SETTINGS)
    expect(typographyFont('source-han-serif').label).toBe('思源宋体')
  })

  it('clamps and rounds the font size into the supported range', () => {
    expect(clampTypographyFontSize(0)).toBe(FONT_SIZE_MIN)
    expect(clampTypographyFontSize(999)).toBe(FONT_SIZE_MAX)
    expect(clampTypographyFontSize(17.6)).toBe(18)
    expect(clampTypographyFontSize(Number.NaN)).toBe(DEFAULT_TYPOGRAPHY_SETTINGS.fontSize)
  })

  it('ignores unknown fonts and out-of-range sizes from storage', () => {
    localStorage.setItem(TYPOGRAPHY_STORAGE_KEY, JSON.stringify({ fontFamily: 'comic-sans', fontSize: 3 }))
    expect(readTypographySettings()).toEqual({ fontFamily: DEFAULT_TYPOGRAPHY_SETTINGS.fontFamily, fontSize: FONT_SIZE_MIN })
  })

  it('persists, applies CSS variables and notifies listeners', () => {
    const listener = vi.fn()
    window.addEventListener(TYPOGRAPHY_CHANGE_EVENT, listener)
    const saved = writeTypographySettings({ fontFamily: 'lxgw-wenkai', fontSize: 22 })

    expect(saved).toEqual({ fontFamily: 'lxgw-wenkai', fontSize: 22 })
    expect(readTypographySettings()).toEqual({ fontFamily: 'lxgw-wenkai', fontSize: 22 })
    const style = document.documentElement.style
    expect(style.getPropertyValue('--font-ui')).toContain('LXGW WenKai')
    expect(style.getPropertyValue('--font-reading')).toContain('LXGW WenKai')
    expect(style.getPropertyValue('--reading-font-size')).toBe('22px')
    expect(document.documentElement.dataset.typographyFont).toBe('lxgw-wenkai')
    expect(listener).toHaveBeenCalledOnce()
    window.removeEventListener(TYPOGRAPHY_CHANGE_EVENT, listener)
  })

  it('returns the normalized settings so callers can mirror the stored values', () => {
    const saved = writeTypographySettings({ fontFamily: 'system', fontSize: 99 })
    expect(saved).toEqual({ fontFamily: 'system', fontSize: FONT_SIZE_MAX })
    expect(readTypographySettings()).toEqual(saved)
    expect(document.documentElement.style.getPropertyValue('--reading-font-size')).toBe(`${FONT_SIZE_MAX}px`)
  })

  it('offers only the known open-source-first font families', () => {
    expect(TYPOGRAPHY_FONTS.map(font => font.id)).toEqual(['source-han-serif', 'source-han-sans', 'lxgw-wenkai', 'system'])
    expect(TYPOGRAPHY_FONTS.filter(font => font.license === 'SIL OFL 1.1')).toHaveLength(3)
  })

  it('applies the serialized stack for a chosen font', () => {
    applyTypographySettings({ fontFamily: 'source-han-sans', fontSize: 16 })
    expect(document.documentElement.style.getPropertyValue('--font-ui')).toContain('Source Han Sans SC')
    expect(document.documentElement.style.getPropertyValue('--reading-font-size')).toBe('16px')
  })
})
