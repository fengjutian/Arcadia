import { describe, expect, it } from 'vitest'
import { importToSpacePayload, parseBookmarksHtml, parseTabsJson, planBookmarkImport } from './bookmarksImport'

const NESTED = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
  <DT><H3>Work</H3>
  <DL><p>
    <DT><A HREF="https://example.com/a">Alpha</A>
    <DT><H3>Reading</H3>
    <DL><p>
      <DT><A HREF="https://example.com/b">Beta</A>
    </DL><p>
  </DL><p>
  <DT><A HREF="javascript:alert(1)">Bad</A>
  <DT><A HREF="https://example.com/a">Alpha again</A>
</DL><p>`

describe('parseBookmarksHtml', () => {
  it('reads anchors and nested folder paths', () => {
    const bookmarks = parseBookmarksHtml(NESTED)
    expect(bookmarks.map(bookmark => bookmark.url)).toEqual([
      'https://example.com/a',
      'https://example.com/b',
      'https://example.com/a',
    ])
    expect(bookmarks[0].folder).toBe('Work')
    expect(bookmarks[1].folder).toBe('Work / Reading')
    expect(bookmarks[0].title).toBe('Alpha')
  })

  it('skips non-http links and empty input', () => {
    expect(parseBookmarksHtml('')).toEqual([])
    expect(parseBookmarksHtml('<a href="ftp://x">x</a>')).toEqual([])
  })
})

describe('planBookmarkImport', () => {
  it('separates new, duplicate and already-saved urls', () => {
    const plan = planBookmarkImport(
      [
        { title: 'A', url: 'https://a.com' },
        { title: 'B', url: 'https://b.com' },
        { title: 'A dup', url: 'https://a.com' },
        { title: 'Saved', url: 'https://saved.com' },
        { title: 'bad', url: 'javascript:1' },
      ],
      new Set(['https://saved.com']),
    )
    expect(plan.unique.map(bookmark => bookmark.url)).toEqual(['https://a.com', 'https://b.com'])
    expect(plan.duplicates.map(bookmark => bookmark.url)).toEqual(['https://a.com', 'https://saved.com'])
    expect(plan.skipped).toBe(1)
  })

  it('builds a versioned Space payload', () => {
    const payload = importToSpacePayload([{ title: 'A', url: 'https://a.com' }, { title: 'B', url: 'https://b.com' }])
    expect(payload.version).toBe(2)
    expect(payload.tabs.map(tab => tab.id)).toEqual(['import-1', 'import-2'])
    expect(payload.activeTabId).toBe('import-1')
    expect(payload.tabs.every(tab => tab.private === false)).toBe(true)
  })

  it('maps bookmark folders to tab groups', () => {
    const payload = importToSpacePayload([
      { title: 'A', url: 'https://a.com', folder: 'Work' },
      { title: 'B', url: 'https://b.com', folder: 'Work' },
      { title: 'C', url: 'https://c.com', folder: 'Reading' },
      { title: 'D', url: 'https://d.com' },
    ])
    expect(payload.tabs[0].groupId).toBe('folder:Work')
    expect(payload.tabs[1].groupId).toBe('folder:Work')
    expect(payload.tabs[2].groupId).toBe('folder:Reading')
    expect(payload.tabs[3]).not.toHaveProperty('groupId')
  })
})

describe('parseTabsJson', () => {
  it('reads a bare array and object wrappers', () => {
    expect(parseTabsJson('[{"url":"https://a.com","title":"A"}]')).toEqual([{ url: 'https://a.com', title: 'A' }])
    expect(parseTabsJson('{"tabs":[{"url":"https://b.com","name":"B"}]}')).toEqual([{ url: 'https://b.com', title: 'B' }])
    expect(parseTabsJson('{"tabs":{"items":["https://c.com"]}}')).toEqual([{ url: 'https://c.com', title: 'https://c.com' }])
  })

  it('skips invalid entries and corrupt files', () => {
    expect(parseTabsJson('not json')).toEqual([])
    expect(parseTabsJson('{"tabs":[{"url":"javascript:1"},{"title":"missing url"}]}')).toEqual([])
  })
})
