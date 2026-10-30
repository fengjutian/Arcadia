import { emitTo } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import type { ReaderArticle } from '../reader/types'

export const FLOATING_ASSISTANT_LABEL = 'ai-assistant'
export const FLOATING_ASSISTANT_STORAGE_KEY = 'ai.floating-assistant.payload'
export const FLOATING_ASSISTANT_CLOSED_EVENT = 'assistant://closed'
export const FLOATING_ASSISTANT_SAVE_EVENT = 'assistant://save-to-library'

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

export async function openFloatingAssistant(payload: FloatingAssistantPayload): Promise<void> {
  localStorage.setItem(FLOATING_ASSISTANT_STORAGE_KEY, JSON.stringify(payload))
  const existing = await WebviewWindow.getByLabel(FLOATING_ASSISTANT_LABEL)
  if (existing) {
    await existing.show()
    await existing.setFocus()
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
}

export async function closeFloatingAssistant(notifyMain = false): Promise<void> {
  const floating = await WebviewWindow.getByLabel(FLOATING_ASSISTANT_LABEL)
  if (notifyMain) await emitTo('main', FLOATING_ASSISTANT_CLOSED_EVENT)
  await floating?.close()
}
