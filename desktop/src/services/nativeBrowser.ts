import { invoke } from '@tauri-apps/api/core'
import { LogicalPosition, LogicalSize } from '@tauri-apps/api/dpi'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { Webview } from '@tauri-apps/api/webview'
import { readSitePermissions } from '../features/browser/sitePermissions'
import { isAdBlockerEnabled } from '../features/plugins/adBlocker'
import { isMissingWebviewError } from '../features/browser/tabViewErrors'

export interface BrowserBounds { x: number; y: number; width: number; height: number }
export interface NativeBrowserState { url: string; title: string; favicon?: string; loading: boolean; scrollX: number; scrollY: number; scrollDepth?: number; canGoBack: boolean; canGoForward: boolean }
export interface NativePageSnapshot { url: string; html: string }
export interface NativeResourceCandidate { url:string; initiatorType?:string; transferSize?:number; decodedBodySize?:number; source:'performance'|'dom' }
export interface NetworkDiagnosis { kind:'reachable'|'offline'|'dns'|'timeout'|'tls'|'connection-refused'|'network'|'http-client'|'http-server'; message:string; httpStatus?:number }
interface NativeToolbarMenuEvent { version: number; tabLabel: string; action: string }
export interface NativeToolbarMenuAction { tabId: string; action: string; value?: string }
interface NativeAudioStateEvent { version: number; tabLabel: string; audible: boolean; muted: boolean }
export interface NativeAudioState { tabId: string; audible: boolean; muted: boolean }
export interface NativeProcessFailure { version: number; tabLabel: string; kind: string; fatal: boolean }
export interface PasswordCandidate { origin: string; username: string; password: string }
export interface SavedCredential { id: string; origin: string; username: string; updatedAt: number }
export interface PasswordFillRequest { tabLabel: string; origin: string }

export async function onPasswordCandidate(handler: (candidate: PasswordCandidate) => void): Promise<UnlistenFn> {
  if (!isTauri()) return () => undefined
  return listen<PasswordCandidate>('browser://password-candidate', event => handler(event.payload))
}
export async function onPasswordFillRequest(handler: (request: PasswordFillRequest) => void): Promise<UnlistenFn> {
  if (!isTauri()) return () => undefined
  return listen<PasswordFillRequest>('browser://password-fill-request', event => handler(event.payload))
}
export async function fillBrowserPassword(tabLabel: string, credentialId: string): Promise<void> {
  return invoke('browser_password_fill', { label: tabLabel, credentialId })
}
export async function saveBrowserPassword(candidate: PasswordCandidate): Promise<SavedCredential> { return invoke('browser_password_save', { origin: candidate.origin, username: candidate.username, password: candidate.password }) }
export async function listBrowserPasswords(): Promise<SavedCredential[]> { return isTauri() ? invoke('browser_password_list') : [] }
export async function deleteBrowserPassword(id: string): Promise<boolean> { return isTauri() ? invoke('browser_password_delete', { id }) : false }
export async function generateBrowserPassword(length = 20): Promise<string> { return invoke('browser_password_generate', { length }) }
/**
 * v1: openerLabel + url. Future revisions may add origin, gesture, etc. The
 * `version` field is always present on Rust-emitted events; consumers should
 * treat missing fields as v1.
 */
interface NativeNewTabRequest { version: number; openerLabel: string; url: string; private?: boolean }
/**
 * v2 download progress payload emitted on `browser://download`. Legacy v1
 * fields (`tabLabel`, `url`, `path`, `status`) are preserved; new fields
 * cover id-based dedupe, byte progress, danger classification, and private
 * mode. Missing `version` is treated as v1 (only legacy fields populated).
 */
export interface NativeDownloadUpdate {
  version: number
  kind: 'started' | 'progress' | 'finished' | 'failed' | 'cancelled' | 'blocked'
  id: string
  tabLabel: string
  url: string
  fileName?: string
  targetPath?: string
  mimeType?: string
  receivedBytes?: number
  totalBytes?: number
  progressKnown?: boolean
  status: 'downloading' | 'completed' | 'failed' | 'cancelled' | 'blocked' | 'paused' | 'queued'
  dangerType?: 'none' | 'executable' | 'script' | 'archive' | 'document' | 'other'
  errorMessage?: string
  private?: boolean
  sourceOrigin?: string
}
export const EVENT_PAYLOAD_VERSION = 2
const labels = new Map<string, string>()
const tabOperationTails = new Map<string, Promise<void>>()
const lastAppliedBounds = new Map<string, BrowserBounds>()
const desiredVisibility = new Map<string, boolean>()
const suspendedTabs = new Set<string>()
const isTauri = () => '__TAURI_INTERNALS__' in window
export const isNativeBrowserAvailable = (): boolean => isTauri()
const labelFor = (tabId: string) => `browser-${tabId.replace(/[^a-zA-Z0-9-]/g, '-')}`

function enqueueTabOperation<T>(tabId: string, operation: () => Promise<T>): Promise<T> {
  const previous = tabOperationTails.get(tabId) ?? Promise.resolve()
  const result = previous.catch(() => undefined).then(operation)
  const tail = result.then(() => undefined, () => undefined)
  tabOperationTails.set(tabId, tail)
  void tail.finally(() => {
    if (tabOperationTails.get(tabId) === tail) tabOperationTails.delete(tabId)
  })
  return result
}

function sameBounds(left: BrowserBounds | undefined, right: BrowserBounds): boolean {
  return !!left
    && left.x === right.x
    && left.y === right.y
    && left.width === right.width
    && left.height === right.height
}

/**
 * Forget the cached label and best-effort destroy the native view. Used when
 * the native side reports the WebView is gone: keeping a dead handle in
 * `labels` makes every later show/resize/state call fail against it.
 */
async function forgetNativeTab(tabId: string): Promise<void> {
  const label = labels.get(tabId) ?? labelFor(tabId)
  labels.delete(tabId)
  lastAppliedBounds.delete(tabId)
  desiredVisibility.delete(tabId)
  suspendedTabs.delete(tabId)
  try { await invoke('browser_close_tab', { label }) } catch { /* already gone */ }
  try { await (await Webview.getByLabel(label))?.close() } catch { /* already gone */ }
}

/**
 * `webview not found` means the native WebView died underneath us (LRU sweep,
 * window teardown, half-created tab). Purge the stale handle and rebuild once
 * before letting the error reach the UI.
 */
async function rebuildWhenViewMissing<T>(tabId: string, action: () => Promise<T>): Promise<T> {
  try {
    return await action()
  } catch (error) {
    if (!isMissingWebviewError(error)) throw error
    await forgetNativeTab(tabId)
    return await action()
  }
}

/**
 * Position/size the native view. Throws (including `webview not found`) so the
 * callers that care — `openNativeTab` / `ensureNativeTab` — can rebuild.
 */
async function applyBounds(tabId: string, bounds: BrowserBounds): Promise<void> {
  if (sameBounds(lastAppliedBounds.get(tabId), bounds)) return
  const label = labels.get(tabId)
  if (!label) return
  const view = await Webview.getByLabel(label)
  if (!view) return
  await view.setPosition(new LogicalPosition(bounds.x, bounds.y))
  await view.setSize(new LogicalSize(Math.max(1, bounds.width), Math.max(1, bounds.height)))
  lastAppliedBounds.set(tabId, { ...bounds })
}

async function openNativeTabOnce(tabId: string, url: string, bounds: BrowserBounds, options: { private?: boolean } = {}): Promise<boolean> {
  const label = labelFor(tabId)
  let webview = await Webview.getByLabel(label)
  if (!webview) {
    await invoke('browser_create', { label, url, bounds, permissions: readSitePermissions(), adBlockEnabled: isAdBlockerEnabled(), private: options.private === true })
    webview = await Webview.getByLabel(label)
    if (!webview) throw new Error('browser tab webview was not created')
  } else {
    await invoke<string>('browser_navigate', { label, url })
    await webview.show()
  }
  labels.set(tabId, label)
  await applyBounds(tabId, bounds)
  return true
}

async function ensureNativeTabOnce(tabId: string, url: string, bounds: BrowserBounds, options: { private?: boolean } = {}): Promise<boolean> {
  const label = labelFor(tabId)
  const existing = await Webview.getByLabel(label)
  if (existing) {
    await invoke<string>('browser_navigate', { label, url })
  } else {
    await invoke('browser_create', { label, url, bounds, permissions: readSitePermissions(), adBlockEnabled: isAdBlockerEnabled(), private: options.private === true })
    const created = await Webview.getByLabel(label)
    if (!created) throw new Error('browser tab webview was not created')
  }
  labels.set(tabId, label)
  await applyBounds(tabId, bounds)
  return true
}

export async function openNativeTab(tabId: string, url: string, bounds: BrowserBounds, options: { private?: boolean } = {}): Promise<boolean> {
  if (!isTauri()) return false
  return enqueueTabOperation(tabId, async () => {
    const opened = await rebuildWhenViewMissing(tabId, () => openNativeTabOnce(tabId, url, bounds, options))
    suspendedTabs.delete(tabId)
    return opened
  })
}

export async function ensureNativeTab(tabId: string, url: string, bounds: BrowserBounds, options: { private?: boolean } = {}): Promise<boolean> {
  if (!isTauri()) return false
  return enqueueTabOperation(tabId, async () => {
    const opened = await rebuildWhenViewMissing(tabId, () => ensureNativeTabOnce(tabId, url, bounds, options))
    suspendedTabs.delete(tabId)
    return opened
  })
}

export async function showNativeTab(tabId: string): Promise<void> {
  desiredVisibility.set(tabId, true)
  return enqueueTabOperation(tabId, async () => {
    if (desiredVisibility.get(tabId) !== true) return
    const label = labels.get(tabId)
    if (!label) return
    try {
      await (await Webview.getByLabel(label))?.show()
    } catch (error) {
      if (!isMissingWebviewError(error)) throw error
      labels.delete(tabId)
      lastAppliedBounds.delete(tabId)
    }
  })
}
export async function hideNativeTab(tabId: string): Promise<void> {
  desiredVisibility.set(tabId, false)
  return enqueueTabOperation(tabId, async () => {
    const label = labels.get(tabId)
    if (!label) return
    try {
      await (await Webview.getByLabel(label))?.hide()
    } catch (error) {
      if (!isMissingWebviewError(error)) throw error
      labels.delete(tabId)
      lastAppliedBounds.delete(tabId)
    }
  })
}
export async function closeNativeTab(tabId: string): Promise<void> {
  desiredVisibility.set(tabId, false)
  return enqueueTabOperation(tabId, async () => {
    const label = labels.get(tabId)
    if (label) {
      try { await invoke('browser_close_tab', { label }) }
      catch { await (await Webview.getByLabel(label))?.close() }
    }
    labels.delete(tabId)
    lastAppliedBounds.delete(tabId)
    desiredVisibility.delete(tabId)
    suspendedTabs.delete(tabId)
  })
}
export async function suspendNativeTab(tabId: string): Promise<boolean> {
  desiredVisibility.set(tabId, false)
  return enqueueTabOperation(tabId, async () => {
    const label = labels.get(tabId)
    if (!label || suspendedTabs.has(tabId)) return suspendedTabs.has(tabId)
    await (await Webview.getByLabel(label))?.hide()
    const suspended = await invoke<boolean>('browser_suspend', { label })
    if (suspended) suspendedTabs.add(tabId)
    return suspended
  })
}
export async function resumeNativeTab(tabId: string): Promise<boolean> {
  return enqueueTabOperation(tabId, async () => {
    const label = labels.get(tabId)
    if (!label) return false
    if (!suspendedTabs.has(tabId)) return true
    const resumed = await invoke<boolean>('browser_resume', { label })
    if (resumed) suspendedTabs.delete(tabId)
    return resumed
  })
}
export async function resizeNativeTab(tabId: string, bounds: BrowserBounds): Promise<void> {
  return enqueueTabOperation(tabId, async () => {
    try {
      await applyBounds(tabId, bounds)
    } catch (error) {
      // Layout callbacks are fire-and-forget (`void resizeNativeTab(...)`), so a
      // dead view must not surface as an unhandled rejection.
      if (!isMissingWebviewError(error)) throw error
      labels.delete(tabId)
      lastAppliedBounds.delete(tabId)
    }
  })
}
export async function reloadNativeTab(tabId: string): Promise<void> { const label=labels.get(tabId);if(label)await invoke('browser_reload',{label}) }
export async function stopNativeTab(tabId: string): Promise<void> { const label=labels.get(tabId);if(label)await invoke('browser_stop',{label}) }
export async function editNativePage(tabId: string, action: 'cut'|'paste'|'select-all'): Promise<void> { const label=labels.get(tabId);if(label)await invoke('browser_edit_action',{label,action}) }
export async function clearNativePageData(tabId: string): Promise<void> { const label=labels.get(tabId);if(label)await invoke('browser_clear_page_data',{label}) }
export async function findInNativeTab(tabId: string, query: string, backwards = false): Promise<boolean> { const label=labels.get(tabId);return label ? invoke<boolean>('browser_find',{label,query,backwards}) : false }
export async function zoomNativeTab(tabId: string, scale: number): Promise<void> { const label=labels.get(tabId);if(label)await invoke('browser_zoom',{label,scale}) }
export async function printNativeTab(tabId: string): Promise<void> { const label=labels.get(tabId);if(label)await invoke('browser_print',{label}) }
export async function openNativeDevtools(tabId: string): Promise<void> { const label=labels.get(tabId);if(label)await invoke('browser_open_devtools',{label}) }
export async function captureNativeScreenshot(tabId:string, fullPage:boolean, clip?:{x:number;y:number;width:number;height:number}): Promise<string> { const label=labels.get(tabId);if(!label)throw new Error('native webview is not available');return invoke<string>('browser_capture_screenshot',{label,fullPage,clip:clip??null}) }
export async function navigateHistory(tabId: string, delta: -1|1): Promise<void> { const label=labels.get(tabId);if(label)await invoke('browser_history',{label,delta}) }
export async function readNativeState(tabId: string): Promise<NativeBrowserState | null> { const label=labels.get(tabId);return label ? invoke<NativeBrowserState>('browser_state',{label}) : null }
export async function diagnoseNativeNavigation(url:string): Promise<NetworkDiagnosis> { return invoke<NetworkDiagnosis>('browser_diagnose_url',{url}) }
export async function restoreNativeScroll(tabId: string, x: number, y: number): Promise<void> { const label=labels.get(tabId);if(label)await invoke('browser_restore_scroll',{label,x,y}) }
export async function setNativeToolbarMenu(tabId: string, open: boolean, zoomPercent = 100): Promise<void> {
  const label = labels.get(tabId)
  if (!label) throw new Error('native webview is not available')
  try {
    // A Windows native popup can report success without painting above the
    // child WebView. Render in the page first so the click always has visible
    // feedback; retain the OS menu as a fallback for non-scriptable pages.
    await invoke('browser_toolbar_menu_in_page', { label, open, zoomPercent })
  } catch (pageError) {
    console.warn('in-page toolbar menu failed; falling back to native menu', pageError)
    try {
      await invoke('browser_toolbar_menu', { label, open, zoomPercent })
    } catch (nativeError) {
      throw new Error(`toolbar menu failed (page: ${String(pageError)}; native: ${String(nativeError)})`)
    }
  }
}
export async function setNativeToolbarPanel(tabId: string, open: boolean, kind: 'downloads' | 'bookmarks' | 'resources', payload: unknown): Promise<void> { const label=labels.get(tabId);if(label)await invoke('browser_toolbar_panel',{label,open,kind,payload:JSON.stringify(payload)}) }
/**
 * Paints a toast inside the page instead of the host DOM. Resolves `false`
 * without a live, scriptable page so the caller can fall back to the host layer.
 */
export async function showNativePageToast(tabId: string, toast: { id: string; kind: string; text: string; durationMs: number; theme: 'light' | 'dark' }): Promise<boolean> {
  const label = labels.get(tabId)
  if (!label) return false
  return invoke<boolean>('browser_page_toast', { label, id: toast.id, kind: toast.kind, text: toast.text, durationMs: toast.durationMs, theme: toast.theme })
}
export async function closeNativePageToast(tabId: string, id: string): Promise<void> { const label=labels.get(tabId);if(label)await invoke('browser_page_toast_close',{label,id}) }
export async function isNativeTabAlive(tabId: string): Promise<boolean> { const label=labels.get(tabId) ?? labelFor(tabId);return !!(await Webview.getByLabel(label)) }
export async function setNativeAdBlocking(enabled: boolean): Promise<void> {
  await Promise.all(Array.from(labels.values(), label => invoke('browser_set_ad_blocking', { label, enabled })))
}
export async function setNativeMuted(tabId: string, muted: boolean): Promise<void> { const label=labels.get(tabId);if(label)await invoke('browser_set_muted',{label,muted}) }
export async function captureNativePage(tabId: string): Promise<NativePageSnapshot> { const label=labels.get(tabId);if(!label)throw new Error('native webview is not available');return invoke<NativePageSnapshot>('browser_snapshot',{label}) }
export async function scanNativeResources(tabId: string): Promise<NativeResourceCandidate[]> { const label=labels.get(tabId);if(!label)throw new Error('native webview is not available');return invoke<NativeResourceCandidate[]>('browser_resource_candidates',{label}) }
export function hasNativeTab(tabId: string): boolean { return labels.has(tabId) }
export function isNativeTabSuspended(tabId: string): boolean { return suspendedTabs.has(tabId) }
export async function onNativeNewTab(handler: (url: string, options: { private: boolean }) => void): Promise<UnlistenFn> {
  if (!isTauri()) return () => undefined
  return listen<NativeNewTabRequest>('browser://new-tab', event => handler(event.payload.url, { private: event.payload.private === true }))
}
export async function onNativeDownload(handler: (download: NativeDownloadUpdate) => void): Promise<UnlistenFn> {
  if (!isTauri()) return () => undefined
  return listen<NativeDownloadUpdate>('browser://download', event => handler(event.payload))
}

/** A top-level navigation was cancelled because the host is user-blacklisted. */
export interface NativeSiteBlockedEvent {
  version: number
  tabLabel: string
  url: string
  host: string
  ruleHost: string
  entryId: string
  resourceType: string
}
export async function onNativeSiteBlocked(handler: (event: NativeSiteBlockedEvent) => void): Promise<UnlistenFn> {
  if (!isTauri()) return () => undefined
  return listen<NativeSiteBlockedEvent>('browser://site-blocked', event => {
    if (event.payload?.tabLabel) handler(event.payload)
  })
}

export interface AdBlockUpdate { version: number; tabLabel: string; blockedCount: number }
export async function onNativeAdBlockUpdate(handler: (update: AdBlockUpdate) => void): Promise<UnlistenFn> {
  if (!isTauri()) return () => undefined
  return listen<AdBlockUpdate>('browser://ad-block-update', event => handler(event.payload))
}

export async function onNativeAudioState(handler: (state: NativeAudioState) => void): Promise<UnlistenFn> {
  if (!isTauri()) return () => undefined
  return listen<NativeAudioStateEvent>('browser://audio-state', event => {
    const tabId = Array.from(labels.entries()).find(([, label]) => label === event.payload.tabLabel)?.[0]
    if (tabId) handler({ tabId, audible: event.payload.audible, muted: event.payload.muted })
  })
}

export async function onNativeProcessFailed(handler: (failure: NativeProcessFailure) => void): Promise<UnlistenFn> {
  if (!isTauri()) return () => undefined
  return listen<NativeProcessFailure>('browser://process-failed', event => handler(event.payload))
}

/**
 * Right-click context menu payload emitted by the context-menu init script.
 * `clientX` / `clientY` are the cursor position in viewport coordinates of
 * the WebView itself — the host multiplies by the surface scale + offset
 * before showing the menu.
 */
export interface ContextMenuRequest {
  version: number
  kind: 'page' | 'selection' | 'link' | 'image' | 'input'
  clientX: number
  clientY: number
  selectionText: string
  linkUrl: string | null
  imageUrl: string | null
  editable: boolean
  selectionRect?: { x:number; y:number; width:number; height:number } | null
}

const CONTEXT_MENU_PAYLOAD_VERSION = 1

export async function onNativeContextMenu(handler: (request: ContextMenuRequest) => void): Promise<UnlistenFn> {
  if (!isTauri()) return () => undefined
  return listen<ContextMenuRequest>('browser://context-menu', event => handler(event.payload))
}

export async function onNativeToolbarMenuAction(handler: (request: NativeToolbarMenuAction) => void): Promise<UnlistenFn> {
  if (!isTauri()) return () => undefined
  return listen<NativeToolbarMenuEvent & { value?: string }>('browser://toolbar-menu-action', event => {
    const tabId = Array.from(labels.entries()).find(([, label]) => label === event.payload.tabLabel)?.[0]
    if (tabId) handler({ tabId, action: event.payload.action, value: event.payload.value })
  })
}

/**
 * Best-effort check for "safe" protocols before opening a link from a
 * context menu. The Rust navigation layer also enforces the same rules,
 * but rejecting here keeps the menu item disabled when applicable.
 */
export function isAllowedExternalUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Permission request payload emitted by the JS-level guard script (see
 * `permission_guard_script` in `src-tauri/src/lib.rs`). The host shows an
 * inline prompt and replies via `respond_permission_request`.
 */
export interface PermissionRequest {
  version: number
  requestId: string
  origin: string
  kind: 'camera' | 'microphone' | 'location' | 'notifications' | 'clipboard' | 'media'
}

export async function onPermissionRequest(handler: (request: PermissionRequest) => void): Promise<UnlistenFn> {
  if (!isTauri()) return () => undefined
  return listen<PermissionRequest>('browser://permission-request', event => handler(event.payload))
}

/**
 * Certificate error payload emitted by the Rust certificate guard. The
 * payload intentionally matches the Rust `CertificateErrorPayload` struct so
 * consumers can rely on stable field names.
 */
export interface CertificateErrorPayload {
  requestId: string
  url: string
  message: string
  repeated: boolean
}

const CERTIFICATE_ERROR_EVENT = 'browser://certificate-error'
const CERTIFICATE_ERROR_CLEARED_EVENT = 'browser://certificate-error-cleared'

export async function onCertificateError(handler: (payload: CertificateErrorPayload) => void): Promise<UnlistenFn> {
  if (!isTauri()) return () => undefined
  return listen<CertificateErrorPayload>(CERTIFICATE_ERROR_EVENT, event => handler(event.payload))
}

export async function onCertificateErrorCleared(handler: (requestId: string) => void): Promise<UnlistenFn> {
  if (!isTauri()) return () => undefined
  return listen<string>(CERTIFICATE_ERROR_CLEARED_EVENT, event => handler(event.payload))
}

export async function respondCertificateRequest(requestId: string, allow: boolean): Promise<void> {
  if (!isTauri()) return
  await invoke('browser_certificate_respond', { requestId, allow })
}

/**
 * Forward of `browser_capabilities` from the Rust side. Re-exposed so consumers
 * can stay on the `services/nativeBrowser.ts` import surface.
 */
export { getBrowserCapabilities, peekBrowserCapabilities, BROWSER_CAPABILITIES_FALLBACK, type BrowserCapabilities } from './browserCapabilities'
