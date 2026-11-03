export type View = 'browser'|'library'|'search'|'ai'|'mcp'|'settings'

// Domain types owned by workspace packages; re-exported so the rest of the app
// can keep importing them from the shared `types` module.
export type { BrowserTab, BrowserTabError } from '@arcadia/browser-core/types'
export type {
  AIProvider,
  AIProviderType,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ChatTool,
  ChatToolCall,
  ProviderTestResult,
} from '@arcadia/ai-core/types'

export interface ReadingActivity { url:string; title:string; firstVisitedAt:number; lastVisitedAt:number; activeSeconds:number; maxScrollDepth:number; visitCount:number; excerpt?:string; markdown?:string; capturedAt?:number }
export interface Document { id:string; title:string; url:string; source?:string; author?:string; summary?:string; markdown?:string; wordCount:number; status:'PENDING'|'PROCESSING'|'READY'|'FAILED'|'ARCHIVED'; tags:string[]; autoTags?:string[]; createdAt:string; starred:boolean }
export type TaskStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'
export interface Task { id:string; kind:string; documentId?:string; payload:string; status:TaskStatus; attempts:number; maxAttempts:number; availableAt:string; startedAt?:string; finishedAt?:string; lastError?:string }
