/**
 * Bookmark HTML import (Netscape format exported by Arc / Chrome / Edge / Dia).
 *
 * The parser is deliberately forgiving: only http(s) anchors matter, folder
 * names are collected from the enclosing `<DL>` chain, and duplicates against
 * the current bookmarks are reported before anything is written.
 */

export interface ImportedBookmark {
  title: string
  url: string
  /** Flattened folder path, e.g. "Work / Reading". */
  folder?: string
}

export interface BookmarkImportPlan {
  unique: ImportedBookmark[]
  duplicates: ImportedBookmark[]
  skipped: number
}

function folderPath(anchor: Element): string | undefined {
  const names: string[] = []
  let list = anchor.closest('dl')
  while (list) {
    const heading = list.previousElementSibling
    if (heading?.tagName === 'H3') {
      const name = heading.textContent?.trim()
      if (name) names.unshift(name)
    }
    list = list.parentElement?.closest('dl') ?? null
  }
  return names.length > 0 ? names.join(' / ') : undefined
}

export function parseBookmarksHtml(html: string): ImportedBookmark[] {
  if (typeof DOMParser === 'undefined' || !html.trim()) return []
  const document = new DOMParser().parseFromString(html, 'text/html')
  const bookmarks: ImportedBookmark[] = []
  for (const anchor of Array.from(document.querySelectorAll('a[href]'))) {
    const url = anchor.getAttribute('href')?.trim() ?? ''
    if (!/^https?:\/\//i.test(url)) continue
    const title = anchor.textContent?.trim() || url
    bookmarks.push({ title, url, folder: folderPath(anchor) })
  }
  return bookmarks
}

/** Split imports into new and already-bookmarked URLs. */
export function planBookmarkImport(imported: readonly ImportedBookmark[], existingUrls: ReadonlySet<string>): BookmarkImportPlan {
  const seen = new Set<string>()
  const unique: ImportedBookmark[] = []
  const duplicates: ImportedBookmark[] = []
  let skipped = 0
  for (const bookmark of imported) {
    if (!/^https?:\/\//i.test(bookmark.url)) {
      skipped += 1
      continue
    }
    if (existingUrls.has(bookmark.url) || seen.has(bookmark.url)) {
      duplicates.push(bookmark)
      continue
    }
    seen.add(bookmark.url)
    unique.push(bookmark)
  }
  return { unique, duplicates, skipped }
}

/** Workspace payload so an import can also become a Space. */
export function importToSpacePayload(imported: readonly ImportedBookmark[]): { version: number; tabs: Array<{ id: string; url: string; title: string; private: boolean }>; activeTabId: string } {
  const tabs = imported.map((bookmark, index) => ({
    id: `import-${index + 1}`,
    url: bookmark.url,
    title: bookmark.title,
    private: false,
  }))
  return { version: 2, tabs, activeTabId: tabs[0]?.id ?? '' }
}
