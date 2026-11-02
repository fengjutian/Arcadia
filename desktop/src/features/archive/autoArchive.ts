import type { BrowserTab } from '../../types'

/** Tabs idle longer than this are archived on the next launch. */
export const AUTO_ARCHIVE_IDLE_MS = 12 * 60 * 60 * 1000

/**
 * Decide which tabs should move to the archive on startup.
 *
 * Mirrors Arc's "Today" sweep but errs on the safe side: the active tab,
 * pinned tabs, private tabs, tabs playing audio, loading/crashed tabs and tabs
 * without a recorded activity timestamp are never archived. A tab the user has
 * not touched for `idleMs` is old enough that leaving it in the strip is noise.
 */
export function planAutoArchive(
  tabs: readonly BrowserTab[],
  activeId: string,
  now: number,
  idleMs: number = AUTO_ARCHIVE_IDLE_MS,
): string[] {
  const cutoff = now - idleMs
  return tabs
    .filter(tab => {
      if (tab.id === activeId) return false
      if (tab.pinned || tab.private) return false
      if (tab.loading || tab.crashed) return false
      if (tab.audible && !tab.muted) return false
      if (!tab.url || !/^https?:\/\//i.test(tab.url)) return false
      if (typeof tab.lastActiveAt !== 'number' || tab.lastActiveAt <= 0) return false
      return tab.lastActiveAt <= cutoff
    })
    .map(tab => tab.id)
}
