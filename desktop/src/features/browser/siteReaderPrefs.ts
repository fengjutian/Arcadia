/**
 * Per-site automatic Reader mode.
 *
 * Stored in localStorage next to the other site preferences: the list is small
 * and only the browser route reads it. Reading-mode extraction still needs the
 * page to be captured, so the browser only auto-opens Reader once per URL.
 */

export const READER_SITES_STORAGE_KEY = 'arcadia.reader.sites.v1'
export const READER_SITE_STYLE_KEY = 'arcadia.reader.siteStyle.v1'

export interface ReaderSiteStyle {
  /** CSS pixels; clamped to a readable range. */
  fontSize?: number
  /** Article max width in CSS pixels. */
  width?: number
  /** Reader-only palette. */
  theme?: 'light' | 'sepia' | 'dark'
  /** Comma-separated CSS selectors hidden inside the Reader body. */
  hide?: string
}

export const READER_THEMES = [
  { value: 'light', label: '浅色' },
  { value: 'sepia', label: '护眼' },
  { value: 'dark', label: '深色' },
] as const

export const READER_FONT_SIZES = [14, 16, 18, 20, 22, 24] as const
export const READER_WIDTHS = [640, 760, 900, 1040] as const

export function clampReaderFontSize(value: number): number {
  if (!Number.isFinite(value)) return 18
  return Math.min(24, Math.max(14, Math.round(value)))
}

export function clampReaderWidth(value: number): number {
  if (!Number.isFinite(value)) return 760
  return Math.min(1040, Math.max(640, Math.round(value)))
}

export function normalizeReaderHost(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`)
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    return host || null
  } catch {
    return null
  }
}

export function readReaderSites(): string[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(READER_SITES_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return Array.from(new Set(parsed.filter((value): value is string => typeof value === 'string').map(value => value.trim().toLowerCase()).filter(Boolean)))
  } catch {
    return []
  }
}

export function writeReaderSites(hosts: readonly string[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(READER_SITES_STORAGE_KEY, JSON.stringify(Array.from(new Set(hosts))))
  } catch { /* storage full: keep the in-memory list */ }
}

export function isAutoReaderSite(url: string, hosts: readonly string[]): boolean {
  const host = normalizeReaderHost(url)
  return host ? hosts.includes(host) : false
}

/** Toggle auto-Reader for the URL's host; the input list is not mutated. */
export function toggleReaderSite(hosts: readonly string[], url: string): string[] {
  const host = normalizeReaderHost(url)
  if (!host) return [...hosts]
  return hosts.includes(host) ? hosts.filter(item => item !== host) : [...hosts, host]
}

function normalizeStyle(raw: unknown): ReaderSiteStyle | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const style: ReaderSiteStyle = {}
  if (typeof record.fontSize === 'number' && Number.isFinite(record.fontSize)) style.fontSize = clampReaderFontSize(record.fontSize)
  if (typeof record.width === 'number' && Number.isFinite(record.width)) style.width = clampReaderWidth(record.width)
  if (record.theme === 'light' || record.theme === 'sepia' || record.theme === 'dark') style.theme = record.theme
  if (typeof record.hide === 'string') {
    const hide = normalizeHideSelectors(record.hide)
    if (hide) style.hide = hide
  }
  return style.fontSize || style.width || style.theme || style.hide ? style : null
}

const MAX_HIDE_SELECTORS = 6

/** Only simple selectors are accepted; declarations and markup are rejected. */
export function normalizeHideSelectors(input: string): string {
  return input
    .split(',')
    .map(selector => selector.trim())
    .filter(selector => selector.length > 0 && selector.length <= 120 && !/[{}<>]/.test(selector))
    .slice(0, MAX_HIDE_SELECTORS)
    .join(', ')
}

/** Scoped CSS that hides the selected elements inside the Reader body. */
export function hideCssFor(style: ReaderSiteStyle | null): string {
  const selectors = normalizeHideSelectors(style?.hide ?? '')
  if (!selectors) return ''
  return selectors.split(', ').map(selector => `.reader-document__body ${selector}`).join(', ') + ' { display: none !important; }'
}

export function readReaderSiteStyles(): Record<string, ReaderSiteStyle> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(READER_SITE_STYLE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const styles: Record<string, ReaderSiteStyle> = {}
    for (const [host, value] of Object.entries(parsed as Record<string, unknown>)) {
      const style = normalizeStyle(value)
      if (style) styles[host] = style
    }
    return styles
  } catch {
    return {}
  }
}

/** Style override for the given page URL, if its host has one. */
export function readerStyleFor(url: string): ReaderSiteStyle | null {
  const host = normalizeReaderHost(url)
  return host ? readReaderSiteStyles()[host] ?? null : null
}

export function writeReaderSiteStyle(url: string, style: ReaderSiteStyle | null): void {
  if (typeof localStorage === 'undefined') return
  const host = normalizeReaderHost(url)
  if (!host) return
  try {
    const styles = readReaderSiteStyles()
    const normalized = style ? normalizeStyle(style) : null
    if (normalized) styles[host] = normalized
    else delete styles[host]
    localStorage.setItem(READER_SITE_STYLE_KEY, JSON.stringify(styles))
  } catch { /* storage full: keep the in-memory style */ }
}
