export type View = 'browser'|'library'|'search'|'ai'|'mcp'|'settings'

// Tab types belong to the browser package; re-exported so the rest of the app
// can keep importing them from the shared `types` module.
export type { BrowserTab, BrowserTabError } from '@arcadia/browser-core/types'

export interface ReadingActivity { url:string; title:string; firstVisitedAt:number; lastVisitedAt:number; activeSeconds:number; maxScrollDepth:number; visitCount:number; excerpt?:string; markdown?:string; capturedAt?:number }
export interface Document { id:string; title:string; url:string; source?:string; author?:string; summary?:string; markdown?:string; wordCount:number; status:'PENDING'|'PROCESSING'|'READY'|'FAILED'|'ARCHIVED'; tags:string[]; autoTags?:string[]; createdAt:string; starred:boolean }
export type TaskStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'
export interface Task { id:string; kind:string; documentId?:string; payload:string; status:TaskStatus; attempts:number; maxAttempts:number; availableAt:string; startedAt?:string; finishedAt?:string; lastError?:string }
export type AIProviderType =
  | 'openai-compatible'
  | 'ollama'
  | 'deepseek'
  | 'qwen'
  | 'kimi'
  | 'minimax'
export interface AIProvider { id:string; type:AIProviderType; baseUrl:string; model:string; embeddingModel?:string; timeoutSeconds:number; hasApiKey:boolean; createdAt:string; updatedAt:string }
export interface ChatMessage { role: string; content: string }
export interface ChatTool { name: string; description: string; parameters: Record<string, unknown> }
export interface ChatToolCall { id: string; name: string; arguments: string }
export interface ChatRequest { messages: ChatMessage[]; temperature?: number; maxTokens?: number; tools?: ChatTool[] }
export interface ChatResponse { content: string; promptTokens?: number; completionTokens?: number; toolCalls?: ChatToolCall[] }
export interface ProviderTestResult { ok: boolean; endpoint: string; status?: number; models: string[]; message: string }
