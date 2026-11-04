import { t } from '@arcadia/i18n'
import { emitTo, listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import type { ReaderArticle } from '@arcadia/reader/types'

export const FLOATING_ASSISTANT_LABEL = 'ai-assistant'
export const FLOATING_ASSISTANT_STORAGE_KEY = 'ai.floating-assistant.payload'
export const FLOATING_ASSISTANT_CLOSED_EVENT = 'assistant://closed'
export const FLOATING_ASSISTANT_SAVE_EVENT = 'assistant://save-to-library'
export const FLOATING_ASSISTANT_SAVE_RESULT_EVENT = 'assistant://save-result'
export const FLOATING_ASSISTANT_SAVE_TIMEOUT_MS = 20_000

/**
 * Result of a "save to library" request. The main window owns the actual save
 * (it holds the tab, reader state and collection routing), so it reports back
 * with a message the requesting window can display itself.
 */
export interface SaveToLibraryOutcome {
  type: 'success' | 'info' | 'warning' | 'error'
  message: string
}

export interface FloatingAssistantSaveRequest {
  requestId: string
  /** When false the main window stays silent and the requester shows the outcome. */
  notify: boolean
}

export interface FloatingAssistantSaveResult {
  requestId: string
  outcome: SaveToLibraryOutcome
}

let assistantWindowOperation: Promise<void> = Promise.resolve()

function enqueueAssistantWindowOperation(operation: () => Promise<void>): Promise<void> {
  const result = assistantWindowOperation.catch(() => undefined).then(operation)
  assistantWindowOperation = result.catch(() => undefined)
  return result
}

export interface FloatingAssistantPayload {
  currentUrl: string
  currentTabId: string
  readerArticle: ReaderArticle | null
  pageContextPending: boolean
  pageContextError: string | null
  pdfArticle: ReaderArticle | null
  pdfContextError: string | null
  initialQuestion: string
  initialMode?: 'summarize' | 'ask' | 'translate'
  translationSource: string
}

export function isFloatingAssistantWindow(): boolean {
  return new URLSearchParams(window.location.search).get('window') === 'ai-assistant'
}

export function readFloatingAssistantPayload(): FloatingAssistantPayload | null {
  try {
    const raw = localStorage.getItem(FLOATING_ASSISTANT_STORAGE_KEY)
    return raw ? JSON.parse(raw) as FloatingAssistantPayload : null
  } catch { return null }
}

export function openFloatingAssistant(payload: FloatingAssistantPayload, focusExisting = true): Promise<void> {
  return enqueueAssistantWindowOperation(async () => {
    localStorage.setItem(FLOATING_ASSISTANT_STORAGE_KEY, JSON.stringify(payload))
    const existing = await WebviewWindow.getByLabel(FLOATING_ASSISTANT_LABEL)
    if (existing) {
      await existing.show()
      if (focusExisting) await existing.setFocus()
      await emitTo(FLOATING_ASSISTANT_LABEL, 'assistant://payload-updated', payload)
      return
    }

    const main = getCurrentWindow()
    const [position, size, scale] = await Promise.all([main.outerPosition(), main.innerSize(), main.scaleFactor()])
    const width = 360
    const height = Math.max(560, Math.min(760, size.height / scale - 48))
    const floating = new WebviewWindow(FLOATING_ASSISTANT_LABEL, {
      url: '/?window=ai-assistant',
      title: 'AI Assistant',
      width,
      height,
      x: position.x / scale + size.width / scale - width - 24,
      y: position.y / scale + 72,
      parent: 'main',
      decorations: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: true,
      minWidth: 320,
      minHeight: 480,
      shadow: true,
    })
    await new Promise<void>((resolve, reject) => {
      void floating.once('tauri://created', () => resolve())
      void floating.once('tauri://error', event => reject(new Error(String(event.payload))))
    })
  })
}

/**
 * Ask the main window to archive the current page and wait for its verdict.
 *
 * The floating assistant lives in its own webview, so it cannot read the main
 * window's tab/reader state. It forwards the request, waits for the matching
 * response (tagged with a request id, because the main window may emit other
 * events meanwhile) and resolves with a message the caller renders locally.
 * Without a response the user gets an actionable timeout instead of a click
 * that appears to do nothing.
 */
export async function requestFloatingAssistantSave(notify = true, timeoutMs = FLOATING_ASSISTANT_SAVE_TIMEOUT_MS): Promise<SaveToLibraryOutcome> {
  const requestId = crypto.randomUUID()
  let settle: (outcome: SaveToLibraryOutcome) => void = () => undefined
  const outcome = new Promise<SaveToLibraryOutcome>(resolve => { settle = resolve })
  const unlisten = await listen<FloatingAssistantSaveResult>(FLOATING_ASSISTANT_SAVE_RESULT_EVENT, event => {
    if (event.payload?.requestId !== requestId) return
    settle(event.payload.outcome)
  })
  const timer = setTimeout(() => settle({ type: 'warning', message: t("主窗口没有响应；请回到浏览器窗口后重试。") }), timeoutMs)
  try {
    await emitTo('main', FLOATING_ASSISTANT_SAVE_EVENT, { requestId, notify } satisfies FloatingAssistantSaveRequest)
    return await outcome
  } finally {
    clearTimeout(timer)
    unlisten()
  }
}

export function closeFloatingAssistant(notifyMain = false): Promise<void> {
  return enqueueAssistantWindowOperation(async () => {
    const floating = await WebviewWindow.getByLabel(FLOATING_ASSISTANT_LABEL)
    if (notifyMain) await emitTo('main', FLOATING_ASSISTANT_CLOSED_EVENT)
    await floating?.close()
  })
}
