import type { Document } from '../../types'
import { listDocuments } from '../../api'

export interface DocumentLoadResult {
  items: Document[]
  /** True when the local SQLite store could not be read. */
  unavailable: boolean
  /** Raw command error, kept so the UI can show what actually failed. */
  error: string | null
}

/**
 * Read the document list from the app's own SQLite file.
 *
 * A rejection here is never a network problem — the store is a local
 * `knowledge.db` inside this process — so the message is worth surfacing
 * instead of being collapsed into a generic "offline" state.
 */
export async function loadDocuments(): Promise<DocumentLoadResult> {
  try {
    return { items: await listDocuments(), unavailable: false, error: null }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error ?? '')
    console.error('[library] 读取本地知识库失败', error)
    return { items: [], unavailable: true, error: detail || '未知错误' }
  }
}
