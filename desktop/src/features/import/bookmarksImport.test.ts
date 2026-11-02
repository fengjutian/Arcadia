import { describe, expect, it } from 'vitest'
import { importToSpacePayload, parseBookmarksHtml, planBookmarkImport } from './bookmarksImport'

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
})
