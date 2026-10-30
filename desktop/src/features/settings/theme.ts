export const THEME_PREFERENCES = ['green', 'beige', 'light', 'dark', 'system', 'github', 'ocean', 'cyan', 'mint', 'amber', 'coral', 'rose', 'violet'] as const
export type ThemePreference = typeof THEME_PREFERENCES[number]

const THEME_STORAGE_KEY = 'arcadia-theme'
export const THEME_CHANGE_EVENT = 'arcadia-theme-change'

export function readThemePreference(): ThemePreference {
  const saved = localStorage.getItem(THEME_STORAGE_KEY)
  return THEME_PREFERENCES.includes(saved as ThemePreference) ? saved as ThemePreference : 'green'
}

export function writeThemePreference(theme: ThemePreference) {
  localStorage.setItem(THEME_STORAGE_KEY, theme)
  window.dispatchEvent(new CustomEvent<ThemePreference>(THEME_CHANGE_EVENT, { detail: theme }))
}
