/**
 * Auto-archive preferences.
 *
 * Kept in localStorage rather than the settings page so the archive view can
 * own the controls next to the data they affect. `enabled` exists for users who
 * never want a tab to leave the strip without an explicit action.
 */
export interface AutoArchiveSettings {
  enabled: boolean
  /** Idle window in hours; the startup sweep archives tabs older than this. */
  idleHours: number
  /** Maximum archived rows kept on disk; older entries are pruned on write. */
  retention: number
}

export const AUTO_ARCHIVE_STORAGE_KEY = 'arcadia.archive.settings.v1'

export const AUTO_ARCHIVE_DEFAULT: AutoArchiveSettings = { enabled: true, idleHours: 12, retention: 2000 }

export const AUTO_ARCHIVE_RETENTION_OPTIONS: ReadonlyArray<{ label: string; value: number }> = [
  { label: '500 条', value: 500 },
  { label: '2000 条', value: 2000 },
  { label: '5000 条', value: 5000 },
  { label: '10000 条', value: 10000 },
]

export const AUTO_ARCHIVE_HOUR_OPTIONS: ReadonlyArray<{ label: string; value: number }> = [
  { label: '12 小时', value: 12 },
  { label: '24 小时', value: 24 },
  { label: '3 天', value: 72 },
  { label: '7 天', value: 168 },
]

export function normalizeAutoArchiveSettings(value: unknown): AutoArchiveSettings {
  if (!value || typeof value !== 'object') return { ...AUTO_ARCHIVE_DEFAULT }
  const record = value as Record<string, unknown>
  const enabled = typeof record.enabled === 'boolean' ? record.enabled : AUTO_ARCHIVE_DEFAULT.enabled
  const rawHours = typeof record.idleHours === 'number' ? record.idleHours : Number(record.idleHours)
  const idleHours = Number.isFinite(rawHours) && rawHours >= 1 && rawHours <= 24 * 30
    ? rawHours
    : AUTO_ARCHIVE_DEFAULT.idleHours
  const rawRetention = typeof record.retention === 'number' ? record.retention : Number(record.retention)
  const retention = Number.isFinite(rawRetention) && rawRetention >= 100 && rawRetention <= 50_000
    ? Math.round(rawRetention)
    : AUTO_ARCHIVE_DEFAULT.retention
  return { enabled, idleHours, retention }
}

export function readAutoArchiveSettings(): AutoArchiveSettings {
  if (typeof localStorage === 'undefined') return { ...AUTO_ARCHIVE_DEFAULT }
  try {
    const raw = localStorage.getItem(AUTO_ARCHIVE_STORAGE_KEY)
    if (!raw) return { ...AUTO_ARCHIVE_DEFAULT }
    return normalizeAutoArchiveSettings(JSON.parse(raw))
  } catch {
    return { ...AUTO_ARCHIVE_DEFAULT }
  }
}

export function writeAutoArchiveSettings(settings: AutoArchiveSettings): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(AUTO_ARCHIVE_STORAGE_KEY, JSON.stringify(normalizeAutoArchiveSettings(settings)))
  } catch { /* storage full: keep the in-memory behaviour */ }
}

export function idleMsFor(settings: AutoArchiveSettings): number {
  return settings.idleHours * 60 * 60 * 1000
}
