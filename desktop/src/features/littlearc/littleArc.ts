/**
 * "Little Arc" — a small capture window that saves a link without disturbing
 * the current tab.
 *
 * The window itself only collects a URL. The main window owns the WebView
 * capture pipeline (creation, snapshot, Readability, save), and reports back
 * through events so the small window can show success, an error and a retry.
 */

import { emitTo, listen, type UnlistenFn } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'

export const LITTLE_ARC_LABEL = 'little-arc'
export const LITTLE_ARC_STORAGE_KEY = 'little-arc.payload'
export const LITTLE_ARC_QUERY = 'little-arc'

export const LITTLE_ARC_CAPTURE_EVENT = 'little-arc://capture'
export const LITTLE_ARC_OPEN_EVENT = 'little-arc://open'
export const LITTLE_ARC_OPEN_MAIN_EVENT = 'little-arc://open-main'
export const LITTLE_ARC_RESULT_EVENT = 'little-arc://result'

export interface LittleArcCaptureRequest {
  url: string
  requestId: string
  collectionId?: string | null
}

export interface LittleArcResult {
  requestId: string
  ok: boolean
  error?: string
  title?: string
}

export function isLittleArcWindow(): boolean {
  return new URLSearchParams(window.location.search).get('window') === LITTLE_ARC_QUERY
}

export function readLittleArcPayload(): { url: string } | null {
  try {
    const raw = localStorage.getItem(LITTLE_ARC_STORAGE_KEY)
    return raw ? JSON.parse(raw) as { url: string } : null
  } catch {
    return null
  }
}

const tauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

let windowOperation: Promise<void> = Promise.resolve()

export function openLittleArc(url = ''): Promise<void> {
  const run = async () => {
    if (!tauri()) return
    localStorage.setItem(LITTLE_ARC_STORAGE_KEY, JSON.stringify({ url }))
    const existing = await WebviewWindow.getByLabel(LITTLE_ARC_LABEL)
    if (existing) {
      await existing.show()
      await existing.setFocus()
      await emitTo(LITTLE_ARC_LABEL, LITTLE_ARC_OPEN_EVENT, { url })
      return
    }
    const main = getCurrentWindow()
    const [position, scale] = await Promise.all([main.outerPosition(), main.scaleFactor()])
    const width = 420
    const height = 208
    const floating = new WebviewWindow(LITTLE_ARC_LABEL, {
      url: '/?window=little-arc',
      title: 'Little Arc',
      width,
      height,
      x: position.x / scale + 48,
      y: position.y / scale + 48,
      parent: 'main',
      decorations: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      shadow: true,
    })
    await new Promise<void>((resolve, reject) => {
      void floating.once('tauri://created', () => resolve())
      void floating.once('tauri://error', event => reject(new Error(String(event.payload))))
    })
  }
  windowOperation = windowOperation.catch(() => undefined).then(run)
  return windowOperation
}

export function closeLittleArc(): Promise<void> {
  if (!tauri()) return Promise.resolve()
  return WebviewWindow.getByLabel(LITTLE_ARC_LABEL).then(async window => {
    if (window) await window.close()
  })
}

export function requestLittleArcCapture(request: LittleArcCaptureRequest): Promise<void> {
  if (!tauri()) return Promise.resolve()
  return emitTo('main', LITTLE_ARC_CAPTURE_EVENT, request)
}

export function requestOpenInMain(url: string): Promise<void> {
  if (!tauri()) return Promise.resolve()
  return emitTo('main', LITTLE_ARC_OPEN_MAIN_EVENT, { url })
}

export function listenLittleArcCapture(handler: (request: LittleArcCaptureRequest) => void): Promise<UnlistenFn> {
  if (!tauri()) return Promise.resolve(() => undefined)
  return listen<LittleArcCaptureRequest>(LITTLE_ARC_CAPTURE_EVENT, event => handler(event.payload))
}

export function listenLittleArcOpenMain(handler: (url: string) => void): Promise<UnlistenFn> {
  if (!tauri()) return Promise.resolve(() => undefined)
  return listen<{ url: string }>(LITTLE_ARC_OPEN_MAIN_EVENT, event => handler(event.payload?.url ?? ''))
}

export function emitLittleArcResult(result: LittleArcResult): Promise<void> {
  if (!tauri()) return Promise.resolve()
  return emitTo(LITTLE_ARC_LABEL, LITTLE_ARC_RESULT_EVENT, result)
}

export function listenLittleArcResult(handler: (result: LittleArcResult) => void): Promise<UnlistenFn> {
  if (!tauri()) return Promise.resolve(() => undefined)
  return listen<LittleArcResult>(LITTLE_ARC_RESULT_EVENT, event => handler(event.payload))
}

export function listenLittleArcOpen(handler: (url: string) => void): Promise<UnlistenFn> {
  if (!tauri()) return Promise.resolve(() => undefined)
  return listen<{ url: string }>(LITTLE_ARC_OPEN_EVENT, event => handler(event.payload?.url ?? ''))
}
