/**
 * Pure model for the unified command bar.
 *
 * The bar merges the four legacy palettes (tabs / history / bookmarks /
 * bulk-summary) into one input, following the prefix model users already know
 * from Chrome (`@tabs`) and Firefox (keyword bookmarks):
 *
 *   @  tabs        /  knowledge        ?  ask AI        >  actions
 *
 * Everything in this module is side-effect free so the ranking and grouping
 * can be unit-tested without rendering React.
 */

export type CommandKind = 'tab' | 'history' | 'bookmark' | 'document' | 'action'

/**
 * `all` is the default mixed view. `ask` is not a provider: it turns the typed
 * text into a single "ask the assistant" row.
 */
export type CommandMode = 'all' | 'ask' | 'tabs' | 'bookmarks' | 'history' | 'knowledge' | 'actions'

export interface CommandItem {
  id: string
  kind: CommandKind
  title: string
  subtitle?: string
  /** Short right-aligned label, e.g. 当前 / 固定 / 文件夹名. */
  meta?: string
  /** Extra text that should be searchable but is not displayed. */
  keywords?: string
  /** Display form of the shortcut that also runs this item, e.g. `Ctrl + T`. */
  shortcut?: string
  run: () => void
}

export interface ParsedCommandQuery {
  mode: CommandMode
  query: string
}

const PREFIXES: ReadonlyArray<readonly [string, CommandMode]> = [
  ['@', 'tabs'],
  ['/', 'knowledge'],
  ['?', 'ask'],
  ['>', 'actions'],
]

/** Split a raw input into its provider prefix and the remaining keywords. */
export function parseCommandQuery(raw: string): ParsedCommandQuery {
  const trimmed = raw.trimStart()
  for (const [prefix, mode] of PREFIXES) {
    if (trimmed.startsWith(prefix)) {
      return { mode, query: trimmed.slice(prefix.length).trimStart() }
    }
  }
  return { mode: 'all', query: trimmed.trimEnd() }
}

const MODE_CYCLE: readonly CommandMode[] = ['all', 'tabs', 'bookmarks', 'history', 'knowledge', 'actions']

/** `Tab` inside the bar cycles the provider, mirroring Chrome's domain switch. */
export function nextCommandMode(mode: CommandMode, step = 1): CommandMode {
  const index = MODE_CYCLE.indexOf(mode)
  const start = index === -1 ? 0 : index
  const next = (start + step + MODE_CYCLE.length) % MODE_CYCLE.length
  return MODE_CYCLE[next]
}

/**
 * Score a candidate against the query. Higher is better; `null` means no match.
 * Exact prefix beats substring beats subsequence, and long strings are mildly
 * penalised so "GitHub" outranks "GitHub Actions documentation" for `git`.
 */
export function commandScore(query: string, text: string): number | null {
  const q = query.trim().toLowerCase()
  const t = text.toLowerCase()
  if (!q) return 0
  if (!t) return null

  const direct = t.indexOf(q)
  if (direct === 0) return 1000 - Math.min(t.length, 200) * 0.5
  if (direct > 0) return 800 - Math.min(direct, 200) - Math.min(t.length, 200) * 0.25

  // Subsequence match, e.g. "gh" → "GitHub".
  let cursor = 0
  let gaps = 0
  let lastIndex = -1
  for (const char of q) {
    const found = t.indexOf(char, cursor)
    if (found === -1) return null
    if (lastIndex >= 0 && found > lastIndex + 1) gaps += 1
    lastIndex = found
    cursor = found + 1
  }
  return 400 - gaps * 8 - Math.min(t.length, 200) * 0.5
}

interface ScoredItem {
  item: CommandItem
  score: number
}

function itemText(item: CommandItem): string {
  return [item.title, item.subtitle, item.keywords].filter(Boolean).join(' ')
}

/** Filter + rank a homogeneous list. */
export function rankCommandItems(items: readonly CommandItem[], query: string): CommandItem[] {
  const scored: ScoredItem[] = []
  for (const item of items) {
    const score = commandScore(query, itemText(item))
    if (score !== null) scored.push({ item, score })
  }
  scored.sort((a, b) => b.score - a.score || a.item.title.length - b.item.title.length)
  return scored.map(entry => entry.item)
}

export interface CommandSection {
  kind: CommandKind
  label: string
  items: CommandItem[]
}

export const COMMAND_KIND_LABEL: Record<CommandKind, string> = {
  tab: '标签页',
  action: '动作',
  bookmark: '收藏',
  history: '历史',
  document: '知识库',
}

const EVERY_KIND: readonly CommandKind[] = ['tab', 'action', 'bookmark', 'history', 'document']

const MODE_KINDS: Record<Exclude<CommandMode, 'all' | 'ask'>, readonly CommandKind[]> = {
  tabs: ['tab'],
  bookmarks: ['bookmark'],
  history: ['history'],
  knowledge: ['document'],
  actions: ['action'],
}

const KIND_LIMIT: Record<CommandKind, number> = {
  tab: 6,
  action: 8,
  bookmark: 4,
  history: 4,
  document: 6,
}

/**
 * Group the ranked items into the sections rendered by the palette. With an
 * empty query actions come first (discoverability); once the user types, open
 * tabs lead because that is the most common "go back to…" intent.
 */
export function groupCommandItems(
  items: readonly CommandItem[],
  mode: CommandMode,
  query: string,
): CommandSection[] {
  if (mode === 'ask') return []
  const kinds = mode === 'all' ? EVERY_KIND : MODE_KINDS[mode]
  const order = query.trim().length === 0
    ? (['action', 'tab', 'bookmark', 'history', 'document'] as const)
    : EVERY_KIND
  const sections: CommandSection[] = []
  for (const kind of order) {
    if (!kinds.includes(kind)) continue
    const ranked = rankCommandItems(items.filter(item => item.kind === kind), query)
    if (ranked.length === 0) continue
    sections.push({ kind, label: COMMAND_KIND_LABEL[kind], items: ranked.slice(0, KIND_LIMIT[kind]) })
  }
  return sections
}
