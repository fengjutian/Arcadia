import { invoke } from '@tauri-apps/api/core'

export interface BingDailyImage {
  date: string
  url: string
  title: string
  copyright: string
}

export const BING_DAILY_CHANGE_EVENT = 'arcadia-bing-daily-change'

const CACHE_KEY = 'arcadia-bing-daily-image'
const CACHE_CHECKED_DATE_KEY = 'arcadia-bing-daily-image-checked-date'
const AUTO_REFRESH_KEY = 'arcadia-bing-daily-refresh'
const HISTORY_KEY = 'arcadia-bing-daily-history'
const HISTORY_LIMIT = 12

function isBingDailyImage(value: unknown): value is BingDailyImage {
  if (!value || typeof value !== 'object') return false
  const image = value as Partial<BingDailyImage>
  return Boolean(
    typeof image.date === 'string' && image.date &&
    typeof image.url === 'string' && image.url &&
    typeof image.title === 'string' && image.title &&
    typeof image.copyright === 'string' && image.copyright,
  )
}

function todayKey(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }).replaceAll('-', '')
}

export function readCachedBingDailyImage(): BingDailyImage | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as unknown
    return isBingDailyImage(value) ? value : null
  } catch {
    return null
  }
}

/** Previously loaded daily images, newest first. Kept even after newer ones load. */
export function readBingDailyHistory(): BingDailyImage[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const value = JSON.parse(raw) as unknown
    return Array.isArray(value) ? value.filter(isBingDailyImage) : []
  } catch {
    return []
  }
}

function mergeBingDailyHistory(images: BingDailyImage[]): BingDailyImage[] {
  const byUrl = new Map<string, BingDailyImage>()
  for (const image of [...images, ...readBingDailyHistory()]) {
    if (!isBingDailyImage(image) || byUrl.has(image.url)) continue
    byUrl.set(image.url, image)
  }
  const merged = [...byUrl.values()]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, HISTORY_LIMIT)
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(merged))
  } catch {
    // A full or blocked storage backend must not break the settings page.
  }
  return merged
}

/**
 * Makes an already-loaded daily image the active wallpaper and tells the app
 * root to repaint. Used when picking an older image from the history.
 */
export function selectBingDailyImage(image: BingDailyImage): void {
  localStorage.setItem(CACHE_KEY, JSON.stringify(image))
  mergeBingDailyHistory([image])
  window.dispatchEvent(new CustomEvent<BingDailyImage>(BING_DAILY_CHANGE_EVENT, { detail: image }))
}

export function readBingDailyRefresh(): boolean {
  return localStorage.getItem(AUTO_REFRESH_KEY) !== 'false'
}

export function writeBingDailyRefresh(enabled: boolean) {
  localStorage.setItem(AUTO_REFRESH_KEY, String(enabled))
}

/**
 * Resolves the active daily image and refreshes the retained history.
 *
 * A network round trip happens when the caller forces a refresh, when no image
 * has been cached yet, when the day changed and auto-update is enabled, or when
 * the archive has never been fetched (so the history has something to show).
 * Previously cached images stay in `readBingDailyHistory()` afterwards.
 */
export async function loadBingDailyImage(force = false): Promise<BingDailyImage | null> {
  const cached = readCachedBingDailyImage()
  const today = todayKey()
  const checkedDate = localStorage.getItem(CACHE_CHECKED_DATE_KEY)
  const autoRefresh = readBingDailyRefresh()
  const history = readBingDailyHistory()
  const dayChanged = autoRefresh && checkedDate !== today
  const shouldFetch = force || !cached || dayChanged || history.length < 2
  if (!shouldFetch) {
    if (cached) mergeBingDailyHistory([cached])
    return cached
  }
  if (!('__TAURI_INTERNALS__' in window)) {
    if (cached) mergeBingDailyHistory([cached])
    return cached
  }
  try {
    const images = await invoke<BingDailyImage[]>('bing_daily_images')
    const valid = Array.isArray(images) ? images.filter(isBingDailyImage) : []
    const merged = mergeBingDailyHistory(valid)
    // A historical image the user picked stays active unless a refresh was
    // explicitly requested or the daily rotation is due.
    const active = force || !cached || dayChanged ? (merged[0] ?? cached) : cached
    if (active) {
      localStorage.setItem(CACHE_KEY, JSON.stringify(active))
      localStorage.setItem(CACHE_CHECKED_DATE_KEY, today)
    }
    return active
  } catch {
    if (cached) mergeBingDailyHistory([cached])
    return cached
  }
}
