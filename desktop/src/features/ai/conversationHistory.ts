import { t } from '../../i18n'
export interface SearchableConversationTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface SearchableConversation {
  id: string
  title: string
  updatedAt: string
  turns: readonly SearchableConversationTurn[]
}

export function makeConversationTitle(turns: readonly SearchableConversationTurn[], maxLength = 32): string {
  const firstQuestion = turns.find(turn => turn.role === 'user')?.content.trim().replace(/\s+/g, ' ')
  if (!firstQuestion) return t("\u672A\u547D\u540D\u5BF9\u8BDD")
  return firstQuestion.length > maxLength ? `${firstQuestion.slice(0, maxLength)}…` : firstQuestion
}

export function normalizeConversationTitle(value: string, maxLength = 60): string {
  const normalized = value.trim().replace(/\s+/g, ' ')
  return normalized.slice(0, maxLength)
}

export function filterConversations<T extends SearchableConversation>(items: readonly T[], query: string): T[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return [...items]
  return items.filter(item => {
    const searchable = `${item.title}\n${item.turns.map(turn => turn.content).join('\n')}`.toLocaleLowerCase()
    return terms.every(term => searchable.includes(term))
  })
}