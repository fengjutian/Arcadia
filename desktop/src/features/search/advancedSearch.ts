import type { DocumentSearchHit } from '../../api'

export interface AdvancedSearchQuery {
  text: string
  phrases: string[]
  excluded: string[]
  titles: string[]
  tags: string[]
  sites: string[]
  before?: string
  after?: string
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Parse a deliberately small, predictable local-search syntax. */
export function parseAdvancedSearch(input: string): AdvancedSearchQuery {
  const result: AdvancedSearchQuery = { text: '', phrases: [], excluded: [], titles: [], tags: [], sites: [] }
  const residual: string[] = []
  const tokens = input.match(/(?:[^\s"]+|"[^"]*")+/g) ?? []
  for (const raw of tokens) {
    if (raw.startsWith('"') && raw.endsWith('"')) {
      const phrase = raw.slice(1, -1).trim()
      if (phrase) { result.phrases.push(phrase); residual.push(phrase) }
      continue
    }
    const separator = raw.indexOf(':')
    if (separator > 0) {
      const field = raw.slice(0, separator).toLowerCase()
      const value = raw.slice(separator + 1).trim()
      if (!value) continue
      if (field === 'title') result.titles.push(value)
      else if (field === 'tag') result.tags.push(value)
      else if (field === 'site') result.sites.push(value.toLowerCase())
      else if (field === 'before' && DATE_RE.test(value)) result.before = value
      else if (field === 'after' && DATE_RE.test(value)) result.after = value
      else residual.push(raw)
      continue
    }
    if (raw.startsWith('-') && raw.length > 1) result.excluded.push(raw.slice(1).toLowerCase())
    else residual.push(raw)
  }
  result.text = residual.join(' ').trim()
  return result
}

export function matchesAdvancedSearch(document: DocumentSearchHit, query: AdvancedSearchQuery): boolean {
  const title = document.title.toLocaleLowerCase()
  const tags = [...document.tags, ...(document.autoTags ?? [])].map(tag => tag.toLocaleLowerCase())
  const url = document.url.toLocaleLowerCase()
  const content = [document.title, document.summary ?? '', document.markdown ?? '', tags.join(' '), document.url].join('\n').toLocaleLowerCase()
  if (query.titles.some(value => !title.includes(value.toLocaleLowerCase()))) return false
  if (query.tags.some(value => !tags.some(tag => tag.includes(value.toLocaleLowerCase())))) return false
  if (query.sites.some(value => !urlHost(url).includes(value))) return false
  if (query.phrases.some(value => !content.includes(value.toLocaleLowerCase()))) return false
  if (query.excluded.some(value => content.includes(value))) return false
  if (query.before && document.createdAt.slice(0, 10) >= query.before) return false
  if (query.after && document.createdAt.slice(0, 10) <= query.after) return false
  return true
}

export function dedupeSearchResults(documents: DocumentSearchHit[]): DocumentSearchHit[] {
  const seen = new Set<string>()
  return documents.filter(document => {
    const canonical = canonicalUrl(document.url)
    const key = canonical || `title:${document.title.trim().toLocaleLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function canonicalUrl(value: string): string {
  try {
    const url = new URL(value)
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|spm$|from$|ref$|source$)/i.test(key)) url.searchParams.delete(key)
    }
    url.hostname = url.hostname.toLowerCase()
    url.pathname = url.pathname.replace(/\/$/, '') || '/'
    return url.toString()
  } catch {
    return value.trim().toLocaleLowerCase()
  }
}

function urlHost(value: string): string {
  try { return new URL(value).hostname.toLocaleLowerCase() } catch { return value }
}
