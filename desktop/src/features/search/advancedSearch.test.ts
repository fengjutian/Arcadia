import { describe, expect, it } from 'vitest'
import { dedupeSearchResults, matchesAdvancedSearch, parseAdvancedSearch } from './advancedSearch'
import type { DocumentSearchHit } from '../../api'

const document = (overrides: Partial<DocumentSearchHit> = {}): DocumentSearchHit => ({
  id: '1', title: '南京旅游指南', url: 'https://example.com/nanjing?utm_source=test', summary: '城市历史', markdown: '适合秋季旅行',
  tags: ['旅游'], autoTags: ['南京'], wordCount: 10, status: 'READY', createdAt: '2026-05-20', starred: false, ...overrides,
})

describe('advanced local search', () => {
  it('parses fields, phrases, exclusions and dates', () => {
    expect(parseAdvancedSearch('title:南京 tag:旅游 site:example.com "秋季旅行" -酒店 before:2026-10-01 after:2026-01-01')).toEqual({
      text: '秋季旅行', phrases: ['秋季旅行'], excluded: ['酒店'], titles: ['南京'], tags: ['旅游'], sites: ['example.com'], before: '2026-10-01', after: '2026-01-01',
    })
  })

  it('applies all advanced filters', () => {
    const query = parseAdvancedSearch('title:南京 tag:旅游 site:example.com "秋季旅行" -酒店 before:2026-10-01')
    expect(matchesAdvancedSearch(document(), query)).toBe(true)
    expect(matchesAdvancedSearch(document({ markdown: '秋季旅行酒店推荐' }), query)).toBe(false)
  })

  it('dedupes tracking variants while preserving first-ranked result', () => {
    const second = document({ id: '2', url: 'https://EXAMPLE.com/nanjing?utm_campaign=x' })
    expect(dedupeSearchResults([document(), second])).toHaveLength(1)
    expect(dedupeSearchResults([document(), second])[0].id).toBe('1')
  })
})
