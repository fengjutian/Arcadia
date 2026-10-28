/**
 * Recognising "the native WebView behind this tab is gone".
 *
 * Two spellings reach the frontend:
 *  - `webview not found` — Tauri core's `Error::WebviewNotFound`, returned by
 *    every `plugin:webview|*` command (show/hide/close/set_position/...) when
 *    the label is no longer registered with the app manager.
 *  - `browser tab webview not found` — this app's own Rust commands' wording
 *    for the same condition (`src-tauri/src/lib.rs`).
 *
 * Lives in its own module so both the error classifier (features) and the
 * native bridge (services) can share it without a circular import.
 */
const MISSING_WEBVIEW = /(?:^|\s)webview not found\b/i

export function isMissingWebviewError(error: unknown): boolean {
  const message = String(error ?? '')
  return MISSING_WEBVIEW.test(message) || /browser tab webview not found/i.test(message)
}

export const MISSING_WEBVIEW_MESSAGE =
  '该标签页的原生视图已失效（底层 WebView 不存在），已尝试自动重建。如果仍看到此页面，请点击「重试」。'
