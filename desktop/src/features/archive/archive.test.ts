import { describe, expect, it } from 'vitest'
import type { ArchivedTab } from '../../api'
import type { BrowserTab } from '../../types'
import { archivedTabFromBrowserTab, formatArchivedAt, groupArchivedTabs } from './archive'

function tab(patch: Partial<BrowserTab> = {}): BrowserTab {
  return {
    id: 't1',
    url: 'https://example.com/article',
    title: 'Example article',
    favicon: 'https://example.com/favicon.ico',
    loading: false,
    active: true,
    pinned: false,
    ...patch,
  }
}

function archived(archivedAt: number, title = 'item'): ArchivedTab {
  return { id: String(archivedAt), url: `https://example.com/${title}`, title, archivedAt, source: 'manual' }
}

describe('archivedTabFromBrowserTab', () => {
  it('copies the tab identity and stamps the archive time', () => {
    const entry = archivedTabFromBrowserTab(tab(), 'manual', 1_700_000_000_000)
    expect(entry).toMatchObject({
      url: 'https://example.com/article',
      title: 'Example article',
      favicon: 'https://example.com/favicon.ico',
      archivedAt: 1_700_000_000_000,
      source: 'manual',
      visitedAt: null,
    })
    expect(entry?.id).toBeTruthy()
  })

  it('falls back to the url when the tab has no title', () => {
    expect(archivedTabFromBrowserTab(tab({ title: '' }))?.title).toBe('https://example.com/article')
  })

  it('refuses private tabs, non-http urls and empty tabs', () => {
    expect(archivedTabFromBrowserTab(tab({ private: true }))).toBeNull()
    expect(archivedTabFromBrowserTab(tab({ url: 'file:///tmp/a.md' }))).toBeNull()
    expect(archivedTabFromBrowserTab(tab({ url: '' }))).toBeNull()
  })
})

describe('groupArchivedTabs', () => {
  const now = new Date(2026, 10, 2, 10, 0, 0).getTime()
  const day = 86_400_000

  it('buckets by calendar day and keeps the newest first', () => {
    const sections = groupArchivedTabs([
      archived(now - day * 10, 'old'),
      archived(now - 60_000, 'now'),
      archived(now - day, 'yesterday'),
      archived(now - day * 3, 'week'),
    ], now)
    expect(sections.map(section => section.bucket)).toEqual(['today', 'yesterday', 'week', 'older'])
    expect(sections[0].items.map(item => item.title)).toEqual(['now'])
    expect(sections[3].items.map(item => item.title)).toEqual(['old'])
  })

  it('drops empty buckets and sorts within a bucket', () => {
    const sections = groupArchivedTabs([archived(now - 60_000, 'a'), archived(now - 120_000, 'b')], now)
    expect(sections).toHaveLength(1)
    expect(sections[0].items.map(item => item.title)).toEqual(['a', 'b'])
  })

  it('returns nothing for an empty archive', () => {
    expect(groupArchivedTabs([], now)).toEqual([])
  })
})

describe('formatArchivedAt', () => {
  it('formats a timestamp and tolerates invalid input', () => {
    expect(formatArchivedAt(new Date(2026, 10, 2, 9, 41).getTime())).not.toBe('')
    expect(formatArchivedAt(Number.NaN)).toBe('')
  })
})
