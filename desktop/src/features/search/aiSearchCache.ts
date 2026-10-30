import type { ChatMessage } from '../../types'
import type { AiSearchSource } from './aiSearchPrompt'

export interface AiSearchCacheEntry {
  key: string
  answer: string
  sources: AiSearchSource[]
  citedIds: string[]
  createdAt: number
}

export function aiSearchCacheKey(input: {
  providerId: string
  question: string
  history: readonly ChatMessage[]
  sources: readonly AiSearchSource[]
}): string {
  const material = JSON.stringify({
    providerId:input.providerId,
    question:normalize(input.question),
    history:input.history.slice(-6).map(message => [message.role, normalize(message.content)]),
    sources:input.sources.map(source => [source.documentId, source.url, fingerprint(source.excerpt)]),
  })
  return `v1-${fingerprint(material)}`
}

export function readAiSearchCache(raw: string | null, options?: { now?: number; ttlMs?: number }): AiSearchCacheEntry[] {
  if (!raw) return []
  const now = options?.now ?? Date.now()
  const ttlMs = options?.ttlMs ?? 24 * 60 * 60 * 1000
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is AiSearchCacheEntry => isEntry(entry) && now - entry.createdAt >= 0 && now - entry.createdAt <= ttlMs)
  } catch { return [] }
}

export function upsertAiSearchCache(entries: readonly AiSearchCacheEntry[], entry: AiSearchCacheEntry, limit = 20): AiSearchCacheEntry[] {
  return [entry, ...entries.filter(item => item.key !== entry.key)]
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, Math.max(1, limit))
}

function isEntry(value: unknown): value is AiSearchCacheEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<AiSearchCacheEntry>
  return typeof entry.key === 'string' && typeof entry.answer === 'string' && typeof entry.createdAt === 'number'
    && Array.isArray(entry.sources) && Array.isArray(entry.citedIds)
}

function normalize(value: string): string { return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase() }

function fingerprint(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}
