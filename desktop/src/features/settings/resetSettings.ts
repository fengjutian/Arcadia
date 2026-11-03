import { DEFAULT_ADVANCED_SETTINGS, writeAdvancedSettings } from './advanced'
import { DEFAULT_BROWSER_APPEARANCE, writeBrowserAppearance } from './browserAppearance'
import { DEFAULT_SHELL_SETTINGS, writeShellSettings } from './shell'
import { DEFAULT_DOWNLOAD_SETTINGS, writeDownloadSettings } from './downloadSettings'
import { DEFAULT_TYPOGRAPHY_SETTINGS, writeTypographySettings } from './typography'
import { writeThemePreference } from './theme'
import { writeAppearancePreference, writeBackgroundImageEnabled, writeGlassEffectEnabled, writeImageTheme, writeThemeKind } from './visualTheme'
import { writeBingDailyRefresh } from './bingDailyTheme'
import { DEFAULT_SEARCH_ENGINE_CONFIG, writeSearchEngineConfig } from '../browser/searchEngine'
import { resetAllShortcutOverrides } from '../browser/shortcuts'
import { setAdBlockerEnabled } from '../plugins/adBlocker'
import { setTrackingCleanerEnabled } from '../plugins/trackingCleaner'
import { syncEnginePreferences } from '../../services/enginePreferences'

/** Restore preferences only. User content and credentials are intentionally untouched. */
export function resetBrowserPreferences(): void {
  writeThemePreference('green')
  writeAppearancePreference('system')
  writeImageTheme('alpine')
  // `writeImageTheme` turns the wallpaper on (and opens the image panel); the
  // default appearance is a colour theme without a background image.
  writeBackgroundImageEnabled(false)
  writeThemeKind('color')
  writeGlassEffectEnabled(true)
  writeBingDailyRefresh(true)
  writeBrowserAppearance(DEFAULT_BROWSER_APPEARANCE)
  writeShellSettings(DEFAULT_SHELL_SETTINGS)
  writeDownloadSettings(DEFAULT_DOWNLOAD_SETTINGS)
  writeAdvancedSettings(DEFAULT_ADVANCED_SETTINGS)
  syncEnginePreferences(DEFAULT_ADVANCED_SETTINGS)
  writeTypographySettings(DEFAULT_TYPOGRAPHY_SETTINGS)
  writeSearchEngineConfig(DEFAULT_SEARCH_ENGINE_CONFIG)
  resetAllShortcutOverrides()
  setAdBlockerEnabled(true)
  setTrackingCleanerEnabled(false)
}
