/**
 * Where a message is drawn when the host DOM cannot be seen.
 *
 * On the browser route the page is a native child WebView stacked above the
 * React surface: a host toast over the page is invisible, and a host toast that
 * clears the WebView has to push it down. While a page is live the route
 * therefore registers a sink here that paints the toast inside that page, and
 * the message layer hands plain-text toasts to it instead of rendering them in
 * the host layer.
 *
 * `show` may answer asynchronously: a rejected injection (tab closed, page
 * navigated mid-call) resolves to `false` and the message layer falls back to
 * the host layer, so a notification is never silently dropped.
 */

export type ToastKind = 'success' | 'error' | 'info' | 'warning' | 'loading'

export interface ToastSinkPayload {
  /** Stable toast id; `message.open({key})` updates reuse it. */
  id: string
  kind: ToastKind
  /** Plain text only — injected into the page, so no React nodes. */
  text: string
  /** `0` keeps the toast on screen until it is replaced or dismissed. */
  durationMs: number
  theme: 'light' | 'dark'
}

export interface ToastSink {
  show: (payload: ToastSinkPayload) => boolean | Promise<boolean>
  /** Best-effort dismissal of an id that was handed to `show`. */
  hide: (id: string) => void
}

let current: ToastSink | null = null

/**
 * Installs `sink` as the active surface and returns a cleanup that only clears
 * it when no newer registration has replaced it (two routes can mount in the
 * same commit when the previous view is still animating out).
 */
export function registerToastSink(sink: ToastSink): () => void {
  current = sink
  return () => {
    if (current === sink) current = null
  }
}

export function activeToastSink(): ToastSink | null {
  return current
}
