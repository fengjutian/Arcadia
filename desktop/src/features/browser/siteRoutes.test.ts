import { beforeEach, describe, expect, it } from 'vitest'
import {
  SITE_ROUTES_STORAGE_KEY,
  matchSiteRoute,
  normalizeRouteHost,
  readSiteRoutes,
  removeSiteRoute,
  upsertSiteRoute,
  writeSiteRoutes,
} from './siteRoutes'

beforeEach(() => localStorage.clear())

describe('route storage', () => {
  it('normalises hosts and round-trips rules', () => {
    const routes = upsertSiteRoute([], 'https://www.docs.example.com/a', { collectionId: 'c1' })
    expect(routes).toEqual([expect.objectContaining({ host: 'docs.example.com', collectionId: 'c1', autoReader: false })])
    writeSiteRoutes(routes)
    expect(readSiteRoutes()).toEqual(routes)
  })

  it('updates in place, keeps unrelated fields and removes by host', () => {
    let routes = upsertSiteRoute([], 'example.com', { collectionId: 'c1' })
    routes = upsertSiteRoute(routes, 'https://example.com/x', { autoReader: true })
    expect(routes).toHaveLength(1)
    expect(routes[0]).toMatchObject({ collectionId: 'c1', autoReader: true })
    expect(removeSiteRoute(routes, 'https://www.example.com')).toEqual([])
  })

  it('ignores corrupt payloads and invalid URLs', () => {
    localStorage.setItem(SITE_ROUTES_STORAGE_KEY, '{nope')
    expect(readSiteRoutes()).toEqual([])
    localStorage.setItem(SITE_ROUTES_STORAGE_KEY, '[{"host":42}]')
    expect(readSiteRoutes()).toEqual([])
    expect(upsertSiteRoute([], '   ', { autoReader: true })).toEqual([])
    expect(normalizeRouteHost('')).toBeNull()
  })
})

describe('matchSiteRoute', () => {
  const routes = [
    { host: 'example.com', collectionId: 'root', autoReader: false, updatedAt: 1 },
    { host: 'docs.example.com', collectionId: 'docs', autoReader: true, updatedAt: 2 },
    { host: 'other.com', collectionId: null, autoReader: false, updatedAt: 3 },
  ]

  it('prefers the longest matching suffix', () => {
    expect(matchSiteRoute(routes, 'https://docs.example.com/page')?.collectionId).toBe('docs')
    expect(matchSiteRoute(routes, 'https://www.example.com/page')?.collectionId).toBe('root')
    expect(matchSiteRoute(routes, 'https://other.com')).not.toBeNull()
  })

  it('does not match lookalike or unrelated hosts', () => {
    expect(matchSiteRoute(routes, 'https://notexample.com')).toBeNull()
    expect(matchSiteRoute(routes, 'https://example.org')).toBeNull()
    expect(matchSiteRoute(routes, 'not a url')).toBeNull()
  })
})
