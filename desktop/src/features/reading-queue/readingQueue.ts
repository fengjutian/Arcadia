import type { ReadingQueueEntry } from '../../api'
import type { BrowserTab } from '../../types'

/**
 * Build a queue entry from a tab. Read-later only makes sense for real pages:
 * private tabs never leave a trace and local files have no stable identity.
 */
export function readingQueueEntryFromTab(
  tab: BrowserTab,
  now = Date.now(),
): ReadingQueueEntry | null {
  if (!tab.url || !/^https?:\/\//i.test(tab.url) || tab.private) return null
  return {
    id: crypto.randomUUID(),
    url: tab.url,
    title: tab.title || tab.url,
    favicon: tab.favicon ?? null,
    addedAt: now,
    source: 'manual',
  }
}

/** Compact timestamp for queue rows ("11-02 09:41"). */
export function formatQueuedAt(timestamp: number): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/** Host shown beside a queued item; falls back to the raw URL when unparseable. */
export function queueHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
