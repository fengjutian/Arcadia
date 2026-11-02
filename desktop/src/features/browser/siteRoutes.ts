/**
 * Per-host routing rules ("Air Traffic Control" for a knowledge browser).
 *
 * A rule answers two questions when a page from that host is saved or opened:
 * which collection it belongs to, and whether Reader should open automatically.
 * Matching is by host suffix so `docs.example.com` inherits `example.com`, and
 * the longest matching host wins.
 */

export const SITE_ROUTES_STORAGE_KEY = 'arcadia.site.routes.v1'

export interface SiteRoute {
  host: string
  /** Collection a saved page from this host joins automatically. */
  collectionId: string | null
  /** Open Reader as soon as a page from this host finishes loading. */
  autoReader: boolean
  updatedAt: number
}

export function normalizeRouteHost(input: string): string | null {
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

function normalizeRoute(raw: unknown): SiteRoute | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const host = typeof record.host === 'string' ? normalizeRouteHost(record.host) : null
  if (!host) return null
  return {
    host,
    collectionId: typeof record.collectionId === 'string' && record.collectionId ? record.collectionId : null,
    autoReader: record.autoReader === true,
    updatedAt: typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt) ? record.updatedAt : Date.now(),
  }
}

export function readSiteRoutes(): SiteRoute[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(SITE_ROUTES_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.map(normalizeRoute).filter((route): route is SiteRoute => route !== null)
  } catch {
    return []
  }
}

export function writeSiteRoutes(routes: readonly SiteRoute[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(SITE_ROUTES_STORAGE_KEY, JSON.stringify(routes))
  } catch { /* storage full: rules stay in memory */ }
}

/** Create or update the rule for the URL's host. */
export function upsertSiteRoute(
  routes: readonly SiteRoute[],
  url: string,
  patch: Partial<Pick<SiteRoute, 'collectionId' | 'autoReader'>>,
): SiteRoute[] {
  const host = normalizeRouteHost(url)
  if (!host) return [...routes]
  const existing = routes.find(route => route.host === host)
  const next: SiteRoute = {
    host,
    collectionId: patch.collectionId !== undefined ? patch.collectionId : existing?.collectionId ?? null,
    autoReader: patch.autoReader !== undefined ? patch.autoReader : existing?.autoReader ?? false,
    updatedAt: Date.now(),
  }
  return [...routes.filter(route => route.host !== host), next]
}

export function removeSiteRoute(routes: readonly SiteRoute[], url: string): SiteRoute[] {
  const host = normalizeRouteHost(url)
  return host ? routes.filter(route => route.host !== host) : [...routes]
}

/**
 * Longest host-suffix match. `example.com` matches `www.example.com` and
 * `docs.example.com`, but `notexample.com` does not.
 */
export function matchSiteRoute(routes: readonly SiteRoute[], url: string): SiteRoute | null {
  const host = normalizeRouteHost(url)
  if (!host) return null
  let best: SiteRoute | null = null
  for (const route of routes) {
    if (host === route.host || host.endsWith(`.${route.host}`)) {
      if (!best || route.host.length > best.host.length) best = route
    }
  }
  return best
}
