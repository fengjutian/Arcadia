import { describe, expect, it } from 'vitest'
import {
  commandScore,
  groupCommandItems,
  nextCommandMode,
  parseCommandQuery,
  rankCommandItems,
  type CommandItem,
  type CommandKind,
} from './commandModel'

function item(kind: CommandKind, title: string, patch: Partial<CommandItem> = {}): CommandItem {
  return { id: `${kind}:${title}`, kind, title, run: () => {}, ...patch }
}

describe('parseCommandQuery', () => {
  it('maps prefixes to providers and strips them', () => {
    expect(parseCommandQuery('@git')).toEqual({ mode: 'tabs', query: 'git' })
    expect(parseCommandQuery('/rag')).toEqual({ mode: 'knowledge', query: 'rag' })
    expect(parseCommandQuery('?总结这篇')).toEqual({ mode: 'ask', query: '总结这篇' })
    expect(parseCommandQuery('>save')).toEqual({ mode: 'actions', query: 'save' })
  })

  it('keeps plain input in the mixed view', () => {
    expect(parseCommandQuery('github')).toEqual({ mode: 'all', query: 'github' })
    expect(parseCommandQuery('  spaced  ')).toEqual({ mode: 'all', query: 'spaced' })
  })

  it('treats a lone prefix as an empty provider query', () => {
    expect(parseCommandQuery('@')).toEqual({ mode: 'tabs', query: '' })
  })
})

describe('nextCommandMode', () => {
  it('cycles forward through providers', () => {
    expect(nextCommandMode('all')).toBe('tabs')
    expect(nextCommandMode('tabs')).toBe('bookmarks')
    expect(nextCommandMode('actions')).toBe('all')
  })

  it('cycles backward', () => {
    expect(nextCommandMode('all', -1)).toBe('actions')
    expect(nextCommandMode('tabs', -1)).toBe('all')
  })

  it('falls back to the mixed view from the ask pseudo-mode', () => {
    expect(nextCommandMode('ask')).toBe('all')
  })
})

describe('commandScore', () => {
  it('ranks prefix over substring over subsequence', () => {
    const prefix = commandScore('git', 'GitHub')!
    const substring = commandScore('git', 'My Git notes')!
    const subsequence = commandScore('git', 'Great ideas today')!
    expect(prefix).toBeGreaterThan(substring)
    expect(substring).toBeGreaterThan(subsequence)
  })

  it('returns null when the text cannot match', () => {
    expect(commandScore('zzz', 'GitHub')).toBeNull()
  })

  it('returns zero for an empty query so every candidate survives', () => {
    expect(commandScore('', 'anything')).toBe(0)
  })
})

describe('rankCommandItems', () => {
  it('prefers exact prefixes and drops non-matches', () => {
    const ranked = rankCommandItems([
      item('tab', 'Understanding Git rebase'),
      item('tab', 'GitHub'),
      item('tab', 'Rust book'),
    ], 'git')
    expect(ranked.map(entry => entry.title)).toEqual(['GitHub', 'Understanding Git rebase'])
  })
})

describe('groupCommandItems', () => {
  const items: CommandItem[] = [
    ...Array.from({ length: 8 }, (_, index) => item('tab', `Tab ${index}`)),
    item('action', '新建标签页'),
    item('bookmark', 'MDN'),
    item('history', 'example.com'),
    item('document', 'RAG 笔记'),
  ]

  it('puts actions first while the query is empty', () => {
    expect(groupCommandItems(items, 'all', '')[0].kind).toBe('action')
  })

  it('puts tabs first once the user types', () => {
    expect(groupCommandItems(items, 'all', 'tab')[0].kind).toBe('tab')
  })

  it('caps each section', () => {
    const tabs = groupCommandItems(items, 'all', '').find(section => section.kind === 'tab')
    expect(tabs?.items).toHaveLength(6)
  })

  it('narrows to the requested provider', () => {
    const sections = groupCommandItems(items, 'knowledge', '')
    expect(sections).toHaveLength(1)
    expect(sections[0].kind).toBe('document')
  })

  it('returns nothing for the ask pseudo-mode', () => {
    expect(groupCommandItems(items, 'ask', 'x')).toEqual([])
  })
})
