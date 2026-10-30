import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  APPEARANCE_CHANGE_EVENT,
  readAppearancePreference,
  readImageTheme,
  readThemeKind,
  VISUAL_THEME_CHANGE_EVENT,
  writeAppearancePreference,
  writeImageTheme,
  writeThemeKind,
} from './visualTheme'

describe('visual theme preferences', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => localStorage.clear())

  it('defaults to system appearance and a color theme', () => {
    expect(readAppearancePreference()).toBe('system')
    expect(readThemeKind()).toBe('color')
    expect(readImageTheme()).toBe('alpine')
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
    expect(listener).toHaveBeenCalledTimes(2)
    window.removeEventListener(VISUAL_THEME_CHANGE_EVENT, listener)
  })
})
