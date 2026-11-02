import { describe, expect, it } from 'vitest'
import {
  SITE_SEARCH_SHORTCUTS,
  buildSiteSearchUrl,
  mergeSiteSearchShortcuts,
  parseCustomShortcuts,
  parseTriggerList,
  resolveSiteSearch,
  resolveTabToSearch,
  validateCustomShortcut,
} from './siteSearch'

describe('resolveSiteSearch', () => {
  it('resolves a known bang with its query', () => {
    const resolved = resolveSiteSearch('!gh react hooks')
    expect(resolved?.shortcut.id).toBe('github')
    expect(resolved?.query).toBe('react hooks')
    expect(resolved?.url).toContain('github.com/search')
    expect(resolved?.url).toContain('react%20hooks')
  })

  it('accepts aliases case-insensitively', () => {
    expect(resolveSiteSearch('!GitHub rust')?.shortcut.id).toBe('github')
    expect(resolveSiteSearch('!WIKI 南京')?.shortcut.id).toBe('wikipedia')
  })

  it('returns null without a query or for unknown bangs', () => {
    expect(resolveSiteSearch('!gh')).toBeNull()
    expect(resolveSiteSearch('!gh   ')).toBeNull()
    expect(resolveSiteSearch('!unknown query')).toBeNull()
    expect(resolveSiteSearch('github react')).toBeNull()
  })

  it('keeps every template usable', () => {
    for (const shortcut of SITE_SEARCH_SHORTCUTS) {
      const resolved = resolveSiteSearch(`!${shortcut.triggers[0]} test`)
      expect(resolved?.url).toContain('test')
      expect(resolved?.url.startsWith('https://')).toBe(true)
    }
  })

  it('resolves custom shortcuts passed explicitly', () => {
    const custom = [{ id: 'custom-npm', triggers: ['npm'], label: 'npm', template: 'https://www.npmjs.com/search?q=%s' }]
    expect(resolveSiteSearch('!npm zod', custom)?.url).toBe('https://www.npmjs.com/search?q=zod')
  })
})

describe('parseTriggerList', () => {
  it('splits on spaces, commas and strips bangs', () => {
    expect(parseTriggerList('!gh, github  代码')).toEqual(['gh', 'github', '代码'])
  })
})

describe('validateCustomShortcut', () => {
  const draft = { triggers: 'npm, pkg', label: 'npm', template: 'https://www.npmjs.com/search?q=%s' }

  it('accepts a valid draft and normalises triggers', () => {
    const result = validateCustomShortcut(draft)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.shortcut.triggers).toEqual(['npm', 'pkg'])
  })

  it('rejects missing fields, non-https templates and missing placeholders', () => {
    expect(validateCustomShortcut({ ...draft, triggers: ' ' }).ok).toBe(false)
    expect(validateCustomShortcut({ ...draft, label: ' ' }).ok).toBe(false)
    expect(validateCustomShortcut({ ...draft, template: 'http://example.com?q=%s' }).ok).toBe(false)
    expect(validateCustomShortcut({ ...draft, template: 'https://example.com?q=x' }).ok).toBe(false)
  })

  it('rejects triggers that shadow a built-in or another custom entry', () => {
    expect(validateCustomShortcut({ ...draft, triggers: 'gh' }).ok).toBe(false)
    const first = validateCustomShortcut(draft)
    if (!first.ok) throw new Error('draft should be valid')
    expect(validateCustomShortcut({ ...draft, triggers: 'pkg' }, [first.shortcut]).ok).toBe(false)
  })
})

describe('parseCustomShortcuts', () => {
  it('keeps valid entries and drops corrupt ones', () => {
    const raw = JSON.stringify([
      { id: 'c1', triggers: ['npm'], label: 'npm', template: 'https://www.npmjs.com/search?q=%s' },
      { id: 'c2', triggers: ['gh'], label: 'bad', template: 'https://example.com?q=%s' },
      { id: 'c3', triggers: [], label: '', template: '' },
    ])
    const parsed = parseCustomShortcuts(raw)
    expect(parsed.map(entry => entry.id)).toEqual(['c1'])
  })

  it('returns an empty list for junk input', () => {
    expect(parseCustomShortcuts(null)).toEqual([])
    expect(parseCustomShortcuts('{oops')).toEqual([])
    expect(parseCustomShortcuts('{"a":1}')).toEqual([])
  })
})

describe('mergeSiteSearchShortcuts', () => {
  it('keeps built-ins first', () => {
    const merged = mergeSiteSearchShortcuts([{ id: 'x', triggers: ['npm'], label: 'npm', template: 'https://e.com?q=%s' }])
    expect(merged[0]).toBe(SITE_SEARCH_SHORTCUTS[0])
    expect(merged[merged.length - 1].id).toBe('x')
  })
})

describe('resolveTabToSearch', () => {
  it('maps known domains, with or without scheme and path', () => {
    expect(resolveTabToSearch('github.com')?.id).toBe('github')
    expect(resolveTabToSearch('https://www.github.com/explore')?.id).toBe('github')
    expect(resolveTabToSearch('developer.mozilla.org/en-US/docs')?.id).toBe('mdn')
    expect(resolveTabToSearch('ZH.WIKIPEDIA.ORG')?.id).toBe('wikipedia')
  })

  it('ignores free text and unknown hosts', () => {
    expect(resolveTabToSearch('react hooks')).toBeNull()
    expect(resolveTabToSearch('example.com')).toBeNull()
    expect(resolveTabToSearch('')).toBeNull()
  })

  it('accepts custom shortcuts that declare a host', () => {
    const custom = [{ id: 'custom-npm', triggers: ['npm'], label: 'npm', template: 'https://www.npmjs.com/search?q=%s', hosts: ['npmjs.com'] }]
    expect(resolveTabToSearch('npmjs.com', custom)?.id).toBe('custom-npm')
  })
})

describe('buildSiteSearchUrl', () => {
  it('encodes the query into the template', () => {
    expect(buildSiteSearchUrl(SITE_SEARCH_SHORTCUTS[0], 'a b')).toContain('a%20b')
  })
})
