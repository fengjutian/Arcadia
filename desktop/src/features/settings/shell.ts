/**
 * Shell-level layout preferences.
 *
 * Today this only holds whether the navigation rail is visible. The rail is part
 * of the application frame rather than of one route, so the choice is persisted
 * here and read by `AppLayout` (the settings page only edits it).
 */
export interface ShellSettings {
  /** Show the left navigation rail. Hidden, it frees the whole window width. */
  sidebarVisible: boolean
}

export const SHELL_SETTINGS_KEY = 'arcadia-shell-settings.v1'
export const SHELL_SETTINGS_EVENT = 'arcadia-shell-settings-change'
export const DEFAULT_SHELL_SETTINGS: ShellSettings = { sidebarVisible: true }

export function readShellSettings(): ShellSettings {
  try {
    const value = JSON.parse(localStorage.getItem(SHELL_SETTINGS_KEY) ?? '{}') as Partial<ShellSettings>
    // Only an explicit `false` hides the rail: a partial or corrupted entry must
    // never remove the only navigation surface the user has.
    return { sidebarVisible: value.sidebarVisible !== false }
  } catch {
    return DEFAULT_SHELL_SETTINGS
  }
}

export function writeShellSettings(settings: ShellSettings): ShellSettings {
  const next: ShellSettings = { sidebarVisible: settings.sidebarVisible !== false }
  try {
    localStorage.setItem(SHELL_SETTINGS_KEY, JSON.stringify(next))
  } catch {
    // A blocked storage backend must not break the frame; the in-memory
    // listeners still receive the new value through the event below.
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<ShellSettings>(SHELL_SETTINGS_EVENT, { detail: next }))
  }
  return next
}
