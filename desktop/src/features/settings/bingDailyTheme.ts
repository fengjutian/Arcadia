import { invoke } from '@tauri-apps/api/core'

export interface BingDailyImage {
  date: string
  url: string
  title: string
  copyright: string
}

const CACHE_KEY = 'arcadia-bing-daily-image'
const CACHE_CHECKED_DATE_KEY = 'arcadia-bing-daily-image-checked-date'
const AUTO_REFRESH_KEY = 'arcadia-bing-daily-refresh'

export function readCachedBingDailyImage(): BingDailyImage | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<BingDailyImage>
    return value.date && value.url && value.title && value.copyright ? value as BingDailyImage : null
  } catch {
    return null
  }
}

export function readBingDailyRefresh(): boolean {
  return localStorage.getItem(AUTO_REFRESH_KEY) !== 'false'
}

export function writeBingDailyRefresh(enabled: boolean) {
  localStorage.setItem(AUTO_REFRESH_KEY, String(enabled))
}

export async function loadBingDailyImage(force = false): Promise<BingDailyImage | null> {
  const cached = readCachedBingDailyImage()
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }).replaceAll('-', '')
  const checkedDate = localStorage.getItem(CACHE_CHECKED_DATE_KEY)
  if (!force && cached && (!readBingDailyRefresh() || checkedDate === today)) return cached
  if (!('__TAURI_INTERNALS__' in window)) return cached
  try {
    const image = await invoke<BingDailyImage>('bing_daily_image')
    localStorage.setItem(CACHE_KEY, JSON.stringify(image))
    localStorage.setItem(CACHE_CHECKED_DATE_KEY, today)
    return image
  } catch {
    return cached
  }
}
