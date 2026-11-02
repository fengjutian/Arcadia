/**
 * `!` search shortcuts (Firefox "keyword bookmarks" / DuckDuckGo bangs).
 *
 * Typing `!gh react hooks` in the command bar opens a GitHub search for
 * "react hooks". The table is deliberately small and curated: guessing URL
 * search paths for arbitrary sites breaks as soon as a site changes.
 */
export interface SiteSearchShortcut {
  id: string
  /** Bang names, all matched case-insensitively. */
  triggers: readonly string[]
  label: string
  /** `%s` is replaced with the encoded query. */
  template: string
  /** Hosts that turn `Tab` on a bare domain into a site search. */
  hosts?: readonly string[]
}

export const SITE_SEARCH_SHORTCUTS: readonly SiteSearchShortcut[] = [
  { id: 'github', triggers: ['gh', 'github'], label: 'GitHub', template: 'https://github.com/search?q=%s&type=repositories', hosts: ['github.com'] },
  { id: 'mdn', triggers: ['mdn'], label: 'MDN', template: 'https://developer.mozilla.org/en-US/search?q=%s', hosts: ['developer.mozilla.org'] },
  { id: 'wikipedia', triggers: ['wiki', 'wikipedia'], label: '维基百科', template: 'https://zh.wikipedia.org/w/index.php?search=%s', hosts: ['zh.wikipedia.org', 'wikipedia.org'] },
  { id: 'stackoverflow', triggers: ['so', 'stackoverflow'], label: 'Stack Overflow', template: 'https://stackoverflow.com/search?q=%s', hosts: ['stackoverflow.com'] },
  { id: 'bilibili', triggers: ['bili', 'bilibili'], label: '哔哩哔哩', template: 'https://search.bilibili.com/all?keyword=%s', hosts: ['bilibili.com', 'search.bilibili.com'] },
  { id: 'zhihu', triggers: ['zhihu'], label: '知乎', template: 'https://www.zhihu.com/search?type=content&q=%s', hosts: ['zhihu.com'] },
  { id: 'youtube', triggers: ['yt', 'youtube'], label: 'YouTube', template: 'https://www.youtube.com/results?search_query=%s', hosts: ['youtube.com'] },
  { id: 'arxiv', triggers: ['arxiv'], label: 'arXiv', template: 'https://arxiv.org/search/?query=%s&searchtype=all', hosts: ['arxiv.org'] },
] as const

export interface ResolvedSiteSearch {
  shortcut: SiteSearchShortcut
  query: string
  url: string
}

/**
 * Parse `!trigger query`. Returns `null` for unknown triggers or for a bang
 * without a query, so the command bar can fall through to normal search.
 */
export function resolveSiteSearch(
  input: string,
  shortcuts: readonly SiteSearchShortcut[] = SITE_SEARCH_SHORTCUTS,
): ResolvedSiteSearch | null {
  const trimmed = input.trim()
  if (!trimmed.startsWith('!')) return null
  const match = /^!([A-Za-z0-9_-]+)\s+(\S[\s\S]*)$/.exec(trimmed)
  if (!match) return null
  const [, trigger, rawQuery] = match
  const query = rawQuery.trim()
  if (!query) return null
  const shortcut = shortcuts.find(item =>
    item.triggers.some(name => name.toLowerCase() === trigger.toLowerCase()),
  )
  if (!shortcut) return null
  return {
    shortcut,
    query,
    url: shortcut.template.replace('%s', encodeURIComponent(query)),
  }
}

/** Raw input from the "add shortcut" form. */
export interface CustomShortcutDraft {
  triggers: string
  label: string
  template: string
}

export function parseTriggerList(raw: string): string[] {
  return raw
    .split(/[\s,，]+/)
    .map(value => value.trim().replace(/^!/, '').toLowerCase())
    .filter(Boolean)
}

export type ShortcutValidation =
  | { ok: true; shortcut: SiteSearchShortcut }
  | { ok: false; reason: string }

/**
 * Validate a user-defined shortcut. Templates must be absolute https URLs with
 * a `%s` placeholder; triggers must not shadow a built-in or another custom
 * entry, otherwise the result would depend on list order.
 */
export function validateCustomShortcut(
  draft: CustomShortcutDraft,
  existing: readonly SiteSearchShortcut[] = SITE_SEARCH_SHORTCUTS,
): ShortcutValidation {
  const triggers = Array.from(new Set(parseTriggerList(draft.triggers)))
  if (triggers.length === 0) return { ok: false, reason: '至少填写一个触发词' }
  if (triggers.some(trigger => !/^[a-z0-9_-]+$/.test(trigger))) {
    return { ok: false, reason: '触发词只能包含字母、数字、- 和 _' }
  }
  const label = draft.label.trim()
  if (!label) return { ok: false, reason: '请填写名称' }
  const template = draft.template.trim()
  if (!/^https:\/\//i.test(template)) return { ok: false, reason: 'URL 模板必须以 https:// 开头' }
  if (!template.includes('%s')) return { ok: false, reason: 'URL 模板必须包含 %s 作为查询占位符' }
  const clash = triggers.find(trigger =>
    existing.some(shortcut => shortcut.triggers.some(name => name.toLowerCase() === trigger)),
  )
  if (clash) return { ok: false, reason: `触发词 !${clash} 已被占用` }
  return {
    ok: true,
    shortcut: { id: `custom-${triggers[0]}`, triggers, label, template },
  }
}

/** Parse the persisted JSON array, dropping entries that no longer validate. */
export function parseCustomShortcuts(raw: string | null | undefined): SiteSearchShortcut[] {
  if (!raw) return []
  try {
    const value = JSON.parse(raw) as unknown
    if (!Array.isArray(value)) return []
    const parsed: SiteSearchShortcut[] = []
    for (const entry of value) {
      if (!entry || typeof entry !== 'object') continue
      const record = entry as Record<string, unknown>
      const triggers = Array.isArray(record.triggers)
        ? record.triggers.map(item => String(item)).join(',')
        : String(record.triggers ?? '')
      const result = validateCustomShortcut(
        { triggers, label: String(record.label ?? ''), template: String(record.template ?? '') },
        [...SITE_SEARCH_SHORTCUTS, ...parsed],
      )
      if (!result.ok) continue
      parsed.push({
        ...result.shortcut,
        id: typeof record.id === 'string' && record.id ? record.id : result.shortcut.id,
      })
    }
    return parsed
  } catch {
    return []
  }
}

/** Built-ins first so they always win; custom entries only add new triggers. */
export function mergeSiteSearchShortcuts(
  custom: readonly SiteSearchShortcut[],
): SiteSearchShortcut[] {
  return [...SITE_SEARCH_SHORTCUTS, ...custom]
}

function normalizeHost(input: string): string | null {
  const trimmed = input.trim().toLowerCase()
  if (!trimmed || /\s/.test(trimmed)) return null
  try {
    const withScheme = /^[a-z]+:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`
    return new URL(withScheme).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

/**
 * Chrome-style Tab-to-search: a bare known domain in the command bar turns the
 * next `Tab` into "search inside this site". Only hosts we ship a template for
 * qualify — guessing a site's search URL would navigate to a 404.
 */
export function resolveTabToSearch(
  input: string,
  shortcuts: readonly SiteSearchShortcut[] = SITE_SEARCH_SHORTCUTS,
): SiteSearchShortcut | null {
  const host = normalizeHost(input)
  if (!host) return null
  return shortcuts.find(shortcut =>
    shortcut.hosts?.some(candidate => candidate.replace(/^www\./, '') === host),
  ) ?? null
}

export function buildSiteSearchUrl(shortcut: SiteSearchShortcut, query: string): string {
  return shortcut.template.replace('%s', encodeURIComponent(query))
}
