import { invoke } from '@tauri-apps/api/core'
import type { AdvancedSettings } from '../features/settings/advanced'

/**
 * Mirrors the performance switches that must be known before the next WebView2
 * environment starts (hardware acceleration is a launch flag, so it applies
 * after a restart). The prewarm pool reads `startupBoost` in the renderer and
 * needs no native mirror.
 *
 * Fire-and-forget: a missing mirror only means the switch takes effect one
 * launch later, which must never block the settings page.
 */
export function syncEnginePreferences(settings: Pick<AdvancedSettings, 'hardwareAcceleration'>): void {
  if (!('__TAURI_INTERNALS__' in window)) return
  void invoke('browser_set_engine_preferences', {
    hardwareAcceleration: settings.hardwareAcceleration,
  }).catch(() => undefined)
}
