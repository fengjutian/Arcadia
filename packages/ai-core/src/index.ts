/**
 * Public surface of the AI package.
 *
 * The app imports either the flat surface (`@arcadia/ai-core`) or a specific
 * module (`@arcadia/ai-core/summarize`) when it wants the dependency explicit.
 * Chat views and the MCP-driven agent loop stay in the desktop app.
 */

export * from './types'
export * from './aiApi'
export * from './ask'
export * from './autoTag'
export * from './bm25'
export * from './bulkSummary'
export * from './conversation'
export * from './conversationHistory'
export * from './crossAsk'
export * from './floatingAssistant'
export * from './knowledgeAttachmentAdapter'
export * from './rag'
export * from './reranker'
export * from './retrievalEval'
export * from './streamChat'
export * from './summarize'
export * from './translate'
export * from './useStreamingChat'
