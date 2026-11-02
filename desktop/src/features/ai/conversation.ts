import type { ChatMessage } from '../../types'
import type { AgentStep } from './agentLoop'

export interface StoredConversationTurn {
  id: string
  role: 'user' | 'assistant'
  content: string
  /** 1-based document indexes emitted by the legacy `[doc-N]` answer format. */
  docIds?: number[]
  /** Real document ids emitted by the RAG pipeline. Preferred over `docIds`. */
  documentIds?: string[]
  /** Full citation payload, including note/clip/archive sources without a document row. */
  citations?: Array<{ citationId: string; documentId: string; chunkId: string; title: string; url: string; excerpt: string }>
  notFound?: boolean
  error?: string
  pending?: boolean
  interrupted?: boolean
  generalKnowledge?: boolean
  backgroundTaskId?: string
  /** Bounded research-agent trail, including MCP tool calls. */
  steps?: AgentStep[]
}

/** Error text written by older builds when a pending answer was reloaded. */
export const LEGACY_INTERRUPTION_ERROR = '生成因应用重新加载而中断'

export function isInterruptionError(error: string | undefined): boolean {
  if (!error) return false
  return error === LEGACY_INTERRUPTION_ERROR || error.includes('应用重新加载')
}

export function parseStoredConversation(raw: string | null): StoredConversationTurn[] {
  if (!raw) return []
  try {
    const value = JSON.parse(raw) as unknown
    if (!Array.isArray(value)) return []
    return value.filter((item): item is StoredConversationTurn => {
      if (!item || typeof item !== 'object') return false
      const turn = item as Partial<StoredConversationTurn>
      return typeof turn.id === 'string'
        && (turn.role === 'user' || turn.role === 'assistant')
        && typeof turn.content === 'string'
        && turn.content.length <= 100_000
    }).slice(-200).map(turn => {
      const clean: StoredConversationTurn = { id:turn.id, role:turn.role, content:turn.content }
      if (Array.isArray(turn.docIds)) {
        const ids = turn.docIds
          .filter((id): id is number => typeof id === 'number' && Number.isInteger(id) && id > 0)
        if (ids.length > 0) clean.docIds = ids
      }
      if (Array.isArray(turn.documentIds)) {
        const ids = turn.documentIds
          .filter((id): id is string => typeof id === 'string' && id.length > 0)
        if (ids.length > 0) clean.documentIds = ids
      }
      if (turn.notFound === true) clean.notFound = true
      if (typeof turn.error === 'string' && turn.error.length > 0) clean.error = turn.error
      if (turn.pending === true) clean.pending = true
      if (turn.interrupted === true) clean.interrupted = true
      if (turn.generalKnowledge === true) clean.generalKnowledge = true
      if (typeof turn.backgroundTaskId === 'string' && turn.backgroundTaskId.length > 0) clean.backgroundTaskId = turn.backgroundTaskId
      if (Array.isArray(turn.steps)) {
        const steps: AgentStep[] = turn.steps
          .filter((item): item is AgentStep => Boolean(item) && typeof item === 'object')
          .slice(0, 20)
          .map((step, index) => {
            const bounded: AgentStep = {
              index: typeof step.index === 'number' ? step.index : index + 1,
              kind: step.kind === 'search' || step.kind === 'mcp_tool' || step.kind === 'answer' ? step.kind : 'answer',
              summary: typeof step.summary === 'string' ? step.summary.slice(0, 300) : '',
              ...(typeof step.detail === 'string' ? { detail: step.detail.slice(0, 4000) } : {}),
              at: typeof step.at === 'string' ? step.at : '',
            }
            if (step.result !== undefined) {
              try {
                const serialized = JSON.stringify(step.result)
                if (serialized && serialized.length <= 20_000) bounded.result = step.result
              } catch { /* drop unserializable payloads */ }
            }
            return bounded
          })
          .filter(step => step.summary.length > 0)
        if (steps.length > 0) clean.steps = steps
      }
      return clean
    })
  } catch { return [] }
}

/**
 * Normalize a persisted conversation before rendering it.
 *
 * A pending answer can never be resumed after a reload, and older builds
 * rewrote that dead state as a red error turn on every launch. Both forms are
 * converted to one explicit `interrupted` turn so the UI can offer a retry
 * instead of accumulating duplicate error rows.
 */
export function restoreConversation(raw: string | null): StoredConversationTurn[] {
  return parseStoredConversation(raw).map(turn => {
    if (turn.role !== 'assistant') return turn
    const wasPending = turn.pending === true
    if (wasPending && turn.backgroundTaskId) return turn
    const legacyInterruption = isInterruptionError(turn.error)
    if (!wasPending && !legacyInterruption && turn.interrupted !== true) return turn
    return {
      ...turn,
      pending: false,
      interrupted: true,
      error: undefined,
      // The old error text is synthetic; drop it so the notice can explain the
      // interruption once instead of repeating it in the message body.
      content: wasPending || legacyInterruption ? '' : turn.content,
    }
  })
}

/** Keep recent complete turns inside a character budget without splitting a message. */
export function compactChatHistory(messages: readonly ChatMessage[], maxChars = 12_000): ChatMessage[] {
  const budget = Math.max(0, maxChars)
  const kept: ChatMessage[] = []
  let used = 0
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (kept.length > 0 && used + message.content.length > budget) break
    if (kept.length === 0 && message.content.length > budget) {
      kept.unshift({ ...message, content: message.content.slice(-budget) })
      break
    }
    kept.unshift(message)
    used += message.content.length
  }
  return kept
}
