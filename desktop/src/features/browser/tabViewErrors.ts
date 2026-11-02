import { t } from '../../i18n'
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

export const MISSING_WEBVIEW_MESSAGE =t("\u8BE5\u6807\u7B7E\u9875\u7684\u539F\u751F\u89C6\u56FE\u5DF2\u5931\u6548\uFF08\u5E95\u5C42 WebView \u4E0D\u5B58\u5728\uFF09\uFF0C\u5DF2\u5C1D\u8BD5\u81EA\u52A8\u91CD\u5EFA\u3002\u5982\u679C\u4ECD\u770B\u5230\u6B64\u9875\u9762\uFF0C\u8BF7\u70B9\u51FB\u300C\u91CD\u8BD5\u300D\u3002")