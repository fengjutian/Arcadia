import { DEFAULT_ADVANCED_SETTINGS, writeAdvancedSettings } from './advanced'
import { DEFAULT_BROWSER_APPEARANCE, writeBrowserAppearance } from './browserAppearance'
import { DEFAULT_DOWNLOAD_SETTINGS, writeDownloadSettings } from './downloadSettings'
import { DEFAULT_TYPOGRAPHY_SETTINGS, writeTypographySettings } from './typography'
import { writeThemePreference } from './theme'
import { writeAppearancePreference, writeImageTheme, writeThemeKind } from './visualTheme'
import { writeBingDailyRefresh } from './bingDailyTheme'
import { DEFAULT_SEARCH_ENGINE_CONFIG, writeSearchEngineConfig } from '../browser/searchEngine'
import { resetAllShortcutOverrides } from '../browser/shortcuts'
import { setAdBlockerEnabled } from '../plugins/adBlocker'
import { setTrackingCleanerEnabled } from '../plugins/trackingCleaner'

/** Restore preferences only. User content and credentials are intentionally untouched. */
export function resetBrowserPreferences(): void {
  writeThemePreference('green')
  writeAppearancePreference('system')
  writeThemeKind('color')
  writeImageTheme('alpine')
  writeThemeKind('color')
  writeBingDailyRefresh(true)
  writeBrowserAppearance(DEFAULT_BROWSER_APPEARANCE)
  writeDownloadSettings(DEFAULT_DOWNLOAD_SETTINGS)
  writeAdvancedSettings(DEFAULT_ADVANCED_SETTINGS)
  writeTypographySettings(DEFAULT_TYPOGRAPHY_SETTINGS)
  writeSearchEngineConfig(DEFAULT_SEARCH_ENGINE_CONFIG)
  resetAllShortcutOverrides()
  setAdBlockerEnabled(true)
  setTrackingCleanerEnabled(false)
}
