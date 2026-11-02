import { t } from '../../i18n'
import type { ArchivedTab } from '../../api'
import type { BrowserTab } from '../../types'

/**
 * Build the archive record for a browser tab. Only http(s) tabs can be
 * archived: private tabs must never leak into the on-disk archive, and local
 * protocols have no stable identity to restore later.
 */
export function archivedTabFromBrowserTab(
  tab: BrowserTab,
  source: 'manual' | 'auto' = 'manual',
  now = Date.now(),
): ArchivedTab | null {
  if (!tab.url || !/^https?:\/\//i.test(tab.url)) return null
  if (tab.private) return null
  return {
    id: crypto.randomUUID(),
    url: tab.url,
    title: tab.title || tab.url,
    favicon: tab.favicon ?? null,
    archivedAt: now,
    visitedAt: null,
    source,
    workspaceId: null,
  }
}

export type ArchiveBucket = 'today' | 'yesterday' | 'week' | 'older'

export interface ArchiveSection {
  bucket: ArchiveBucket
  label: string
  items: ArchivedTab[]
}

const BUCKET_LABEL: Record<ArchiveBucket, string> = {
  today:t("今天"),
  yesterday:t("昨天"),
  week:t("最近七天"),
  older:t("更早"),
}

const BUCKET_ORDER: readonly ArchiveBucket[] = ['today', 'yesterday', 'week', 'older']

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function bucketOf(archivedAt: number, now: number): ArchiveBucket {
  const days = Math.floor((startOfDay(now) - startOfDay(archivedAt)) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return 'week'
  return 'older'
}

/** Group archived tabs into day buckets, newest first inside each bucket. */
export function groupArchivedTabs(items: readonly ArchivedTab[], now = Date.now()): ArchiveSection[] {
  const buckets = new Map<ArchiveBucket, ArchivedTab[]>()
  for (const item of items) {
    const bucket = bucketOf(item.archivedAt, now)
    const list = buckets.get(bucket) ?? []
    list.push(item)
    buckets.set(bucket, list)
  }
  return BUCKET_ORDER
    .filter(bucket => buckets.has(bucket))
    .map(          (bucket



     )          =>( {bucket,label:BUCKET_LABEL[bucket],items:(buckets.get(bucket)??[]).slice().sort((left,right)=>right.archivedAt-left.archivedAt),}))
}

/** Compact timestamp for archive rows ("11-02 09:41"). */
export function formatArchivedAt(timestamp: number): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}