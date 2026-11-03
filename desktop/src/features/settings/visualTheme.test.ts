import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  APPEARANCE_CHANGE_EVENT,
  GLASS_EFFECT_CHANGE_EVENT,
  readAppearancePreference,
  readBackgroundImageEnabled,
  readGlassEffectEnabled,
  readImageTheme,
  readThemeKind,
  VISUAL_THEME_CHANGE_EVENT,
  writeAppearancePreference,
  writeBackgroundImageEnabled,
  writeGlassEffectEnabled,
  writeImageTheme,
  writeThemeKind,
  type VisualThemeChangeDetail,
} from './visualTheme'

describe('visual theme preferences', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => localStorage.clear())

  it('defaults to system appearance, a color theme and no wallpaper', () => {
    expect(readAppearancePreference()).toBe('system')
    expect(readThemeKind()).toBe('color')
    expect(readImageTheme()).toBe('alpine')
    expect(readBackgroundImageEnabled()).toBe(false)
  })

  it('persists appearance and notifies the app', () => {
    const listener = vi.fn()
    window.addEventListener(APPEARANCE_CHANGE_EVENT, listener)
    writeAppearancePreference('dark')
    expect(readAppearancePreference()).toBe('dark')
    expect(listener).toHaveBeenCalledOnce()
    window.removeEventListener(APPEARANCE_CHANGE_EVENT, listener)
  })

  it('selecting an image activates and persists the image theme', () => {
    const listener = vi.fn()
    window.addEventListener(VISUAL_THEME_CHANGE_EVENT, listener)
    writeThemeKind('color')
    writeImageTheme('aurora')
    expect(readThemeKind()).toBe('image')
    expect(readImageTheme()).toBe('aurora')
    expect(readBackgroundImageEnabled()).toBe(true)
    expect(listener).toHaveBeenCalledTimes(2)
    window.removeEventListener(VISUAL_THEME_CHANGE_EVENT, listener)
  })

  // Regression: picking a color theme used to switch the theme kind to 'color',
  // which hid the wallpaper the user had set. The two settings are independent.
  it('keeps the background image when the color theme or panel changes', () => {
    writeImageTheme('bing')
    writeThemeKind('color')
    expect(readThemeKind()).toBe('color')
    expect(readImageTheme()).toBe('bing')
    expect(readBackgroundImageEnabled()).toBe(true)

    writeBackgroundImageEnabled(false)
    expect(readBackgroundImageEnabled()).toBe(false)
    expect(readImageTheme()).toBe('bing')
  })

  it('reports the wallpaper state in the change event', () => {
    let detail: VisualThemeChangeDetail | undefined
    const listener = (event: Event) => { detail = (event as CustomEvent<VisualThemeChangeDetail>).detail }
    window.addEventListener(VISUAL_THEME_CHANGE_EVENT, listener)
    writeImageTheme('forest')
    expect(detail).toEqual({ kind: 'image', image: 'forest', background: true })
    writeThemeKind('color')
    expect(detail).toEqual({ kind: 'color', image: 'forest', background: true })
    window.removeEventListener(VISUAL_THEME_CHANGE_EVENT, listener)
  })

  it('migrates the legacy theme kind into the wallpaper setting once', () => {
    localStorage.setItem('arcadia-theme-kind', 'image')
    expect(readBackgroundImageEnabled()).toBe(true)

    localStorage.setItem('arcadia-theme-kind', 'color')
    expect(readBackgroundImageEnabled()).toBe(false)

    localStorage.setItem('arcadia-background-image', 'false')
    localStorage.setItem('arcadia-theme-kind', 'image')
    expect(readBackgroundImageEnabled()).toBe(false)
  })

  it('toggles the glass material on the document and persists the choice', () => {
    const listener = vi.fn()
    window.addEventListener(GLASS_EFFECT_CHANGE_EVENT, listener)

    expect(readGlassEffectEnabled()).toBe(true)
    expect(document.body.dataset.glass).toBeUndefined()

    writeGlassEffectEnabled(false)
    expect(readGlassEffectEnabled()).toBe(false)
    expect(document.body.dataset.glass).toBe('off')
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ detail: false }))

    writeGlassEffectEnabled(true)
    expect(document.body.dataset.glass).toBe('on')

    window.removeEventListener(GLASS_EFFECT_CHANGE_EVENT, listener)
    delete document.body.dataset.glass
  })
})
