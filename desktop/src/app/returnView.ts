import type { View } from '../types'

const RETURN_VIEW_KEY = 'arcadia-return-view'
const VIEWS: View[] = ['browser', 'library', 'search', 'ai', 'mcp', 'settings']

/**
 * Remembers the current route across a deliberate reload (currently only the
 * language switch). Without this, changing the language from Settings reloads
 * the window and drops the user back on the browser route.
 */
export function rememberViewForReload(view: View): void {
  try {
    sessionStorage.setItem(RETURN_VIEW_KEY, view)
  } catch {
    // Ignore storage failures: the reload still works, it just returns home.
  }
}

/** One-shot read: the saved route is consumed so a normal restart starts on the browser. */
export function takeViewAfterReload(): View | null {
  try {
    const saved = sessionStorage.getItem(RETURN_VIEW_KEY) as View | null
    sessionStorage.removeItem(RETURN_VIEW_KEY)
    return saved && VIEWS.includes(saved) ? saved : null
  } catch {
    return null
  }
}
