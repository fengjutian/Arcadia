/**
 * Per-site "never auto-sleep" exceptions.
 *
 * Stored in localStorage because the LRU sweep runs on the renderer side and
 * the list is tiny. Manual "sleep now" still works for an excluded site — the
 * exception only stops the automatic sweep.
 */

export const SLEEP_EXCEPTIONS_STORAGE_KEY = 'arcadia.sleep.exceptions.v1'

/** Normalise a page URL to the host used in the exception list. */
export function normalizeSleepHost(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
    return host || null
  } catch {
    return null
  }
}

export function readSleepExceptions(): string[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(SLEEP_EXCEPTIONS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return Array.from(new Set(
      parsed
        .filter((value): value is string => typeof value === 'string')
        .map(value => value.trim().toLowerCase().replace(/^www\./, ''))
        .filter(Boolean),
    ))
  } catch {
    return []
  }
}

export function writeSleepExceptions(hosts: readonly string[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(SLEEP_EXCEPTIONS_STORAGE_KEY, JSON.stringify(Array.from(new Set(hosts))))
  } catch { /* storage full: keep the in-memory list */ }
}

export function isSleepExcluded(url: string, exceptions: readonly string[]): boolean {
  const host = normalizeSleepHost(url)
  return host ? exceptions.includes(host) : false
}

/** Add or remove a host; returns the next list (input is not mutated). */
export function toggleSleepException(exceptions: readonly string[], url: string): string[] {
  const host = normalizeSleepHost(url)
  if (!host) return [...exceptions]
  return exceptions.includes(host)
    ? exceptions.filter(item => item !== host)
    : [...exceptions, host]
}

/** Why a tab is asleep, phrased for the tab tooltip. */
export function sleepReasonLabel(reason: 'lru' | 'manual' | undefined): string {
  return reason === 'lru' ? '已休眠（自动回收），点击可恢复' : '已休眠，点击可恢复'
}
