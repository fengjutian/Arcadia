import { beforeEach, describe, expect, it } from 'vitest'
import { resetBrowserPreferences } from './resetSettings'
import { readAdvancedSettings, DEFAULT_ADVANCED_SETTINGS } from './advanced'
import { readBrowserAppearance, DEFAULT_BROWSER_APPEARANCE } from './browserAppearance'
import { readDownloadSettings, DEFAULT_DOWNLOAD_SETTINGS } from './downloadSettings'
import { readTypographySettings, DEFAULT_TYPOGRAPHY_SETTINGS } from './typography'
import { readThemePreference } from './theme'
import { readSearchEngineConfig, DEFAULT_SEARCH_ENGINE_CONFIG } from '../browser/searchEngine'

describe('reset browser preferences', () => {
  beforeEach(() => localStorage.clear())

  it('restores defaults without clearing unrelated user data', () => {
    localStorage.setItem('arcadia-theme', 'violet')
    localStorage.setItem('arcadia-user-notes', 'keep-me')
    localStorage.setItem('arcadia-advanced-settings.v1', JSON.stringify({ maxLiveWebviews: 2 }))
    resetBrowserPreferences()
    expect(readThemePreference()).toBe('green')
    expect(readAdvancedSettings()).toEqual(DEFAULT_ADVANCED_SETTINGS)
    expect(readBrowserAppearance()).toEqual(DEFAULT_BROWSER_APPEARANCE)
    expect(readDownloadSettings()).toEqual(DEFAULT_DOWNLOAD_SETTINGS)
    expect(readTypographySettings()).toEqual(DEFAULT_TYPOGRAPHY_SETTINGS)
    expect(readSearchEngineConfig()).toEqual(DEFAULT_SEARCH_ENGINE_CONFIG)
    expect(localStorage.getItem('arcadia-user-notes')).toBe('keep-me')
  })
})
