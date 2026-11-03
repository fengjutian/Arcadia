/**
 * AI-domain types shared by the provider adapters, prompts and the UI.
 *
 * These used to live in `desktop/src/types.ts`; the app re-exports them so
 * existing imports keep working.
 */

export type AIProviderType =
  | 'openai-compatible'
  | 'ollama'
  | 'deepseek'
  | 'qwen'
  | 'kimi'
  | 'minimax'

export interface AIProvider {
  id: string
  type: AIProviderType
  baseUrl: string
  model: string
  embeddingModel?: string
  timeoutSeconds: number
  hasApiKey: boolean
  createdAt: string
  updatedAt: string
}

export interface ChatMessage {
  role: string
  content: string
}

export interface ChatTool {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface ChatToolCall {
  id: string
  name: string
  arguments: string
}

export interface ChatRequest {
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  tools?: ChatTool[]
}

export interface ChatResponse {
  content: string
  promptTokens?: number
  completionTokens?: number
  toolCalls?: ChatToolCall[]
}

export interface ProviderTestResult {
  ok: boolean
  endpoint: string
  status?: number
  models: string[]
  message: string
}

/**
 * Structural subset of a knowledge-base document needed for prompt building.
 *
 * The app's full Document satisfies this shape, so callers pass it directly
 * without the AI package depending on the library domain.
 */
export interface KnowledgeDocument {
  id: string
  title: string
  url: string
  markdown?: string
  summary?: string
}