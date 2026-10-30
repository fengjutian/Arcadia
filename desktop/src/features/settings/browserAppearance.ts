export type OptionalToolbarItem = 'reader' | 'adBlock' | 'ai' | 'downloads' | 'bookmarks' | 'resources'

export interface BrowserAppearanceSettings {
  defaultZoom: number
  toolbar: Record<OptionalToolbarItem, boolean>
}

export const BROWSER_APPEARANCE_KEY = 'arcadia-browser-appearance.v1'
export const BROWSER_APPEARANCE_EVENT = 'arcadia-browser-appearance-change'
export const DEFAULT_BROWSER_APPEARANCE: BrowserAppearanceSettings = {
  defaultZoom: 1,
  toolbar: { reader: true, adBlock: true, ai: true, downloads: true, bookmarks: true, resources: true },
}

export function normalizeDefaultZoom(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return 1
  return Math.min(3, Math.max(0.5, Math.round(numeric * 10) / 10))
}

export function readBrowserAppearance(): BrowserAppearanceSettings {
  try {
    const value = JSON.parse(localStorage.getItem(BROWSER_APPEARANCE_KEY) ?? '{}') as Partial<BrowserAppearanceSettings>
    const toolbar: Partial<Record<OptionalToolbarItem, boolean>> = value.toolbar ?? {}
    return {
      defaultZoom: normalizeDefaultZoom(value.defaultZoom),
      toolbar: {
        reader: toolbar.reader !== false,
        adBlock: toolbar.adBlock !== false,
        ai: toolbar.ai !== false,
        downloads: toolbar.downloads !== false,
        bookmarks: toolbar.bookmarks !== false,
        resources: toolbar.resources !== false,
      },
    }
  } catch {
    return DEFAULT_BROWSER_APPEARANCE
  }
}

export function writeBrowserAppearance(settings: BrowserAppearanceSettings): BrowserAppearanceSettings {
  const next = { ...settings, defaultZoom: normalizeDefaultZoom(settings.defaultZoom) }
  localStorage.setItem(BROWSER_APPEARANCE_KEY, JSON.stringify(next))
  window.dispatchEvent(new CustomEvent<BrowserAppearanceSettings>(BROWSER_APPEARANCE_EVENT, { detail: next }))
  return next
}
