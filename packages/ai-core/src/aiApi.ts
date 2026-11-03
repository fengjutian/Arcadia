/**
 * Tauri commands owned by the AI chat surface.
 *
 * Provider CRUD, embeddings and RAG jobs stay in the desktop `api.ts` because
 * they are settings/indexing concerns; only the chat calls moved here with the
 * streaming pipeline that uses them.
 */

import { invoke } from '@tauri-apps/api/core'
import type { ChatRequest, ChatResponse } from './types'

const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export async function aiChat(providerId: string, request: ChatRequest): Promise<ChatResponse> {
  if (!isTauri()) throw new Error('Document unavailable')
  return invoke<ChatResponse>('ai_chat', { providerId, request })
}

export async function aiChatStream(providerId: string, request: ChatRequest): Promise<string> {
  if (!isTauri()) throw new Error('Document unavailable')
  return invoke<string>('ai_chat_stream', { providerId, request })
}

export async function aiChatCancel(streamId: string): Promise<boolean> {
  if (!isTauri()) return false
  return invoke<boolean>('ai_chat_cancel', { streamId })
}
