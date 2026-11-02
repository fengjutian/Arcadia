import { t } from '../../i18n'
/**
 * Navigation error classification and file-name sanitization.
 * Extracted from BrowserPage so the logic can be unit-tested without React.
 */
import type { BrowserTabError } from '../../types'
import { diagnoseNativeNavigation } from '../../services/nativeBrowser'
import { isMissingWebviewError, MISSING_WEBVIEW_MESSAGE } from './tabViewErrors'

export { isMissingWebviewError, MISSING_WEBVIEW_MESSAGE } from './tabViewErrors'

export function classifyNavigationError(error: unknown): BrowserTabError {
  const message = String(error)
  // `site-blocked:<host>|<ruleHost>|<entryId>` is emitted by Rust before any
  // request leaves the app; never run a network diagnosis for it.
  const blockedMatch = /^site-blocked:([^|\s]+)\|([^|\s]+)\|([^|\s]+)/i.exec(message)
  if (blockedMatch) {
    return {
      kind: 'site-blocked',
      message:t("\u8BE5\u7F51\u7AD9\u5DF2\u88AB\u5C01\u6740\uFF08{value0}\uFF09",{value0:blockedMatch[2]}),
      host: blockedMatch[1],
      ruleHost: blockedMatch[2],
      entryId: blockedMatch[3],
    }
  }
  const protocolMatch = /^(external|blocked|unknown)-protocol:([a-z]+)/i.exec(message)
  if (protocolMatch) {
    const scheme = protocolMatch[2]
    return { kind: 'unsupported-protocol', message:t("\u4E0D\u652F\u6301\u7684\u534F\u8BAE\uFF1A{value0}://\uFF08\u5E94\u7528\u4EC5\u6253\u5F00 http/https \u94FE\u63A5\uFF09",{value0:scheme})}
  }
  // A missing view is a lifecycle problem, not a network problem — never show
  // the raw Tauri/Rust string to the user.
  if (isMissingWebviewError(message)) {
    return { kind: 'tab-view-missing', message: MISSING_WEBVIEW_MESSAGE }
  }
  return { kind: 'load-failed', message }
}

export function safeFileName(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').slice(0, 100) ||t("\u7F51\u9875")
}

export async function diagnoseNavigationError(url: string, error: unknown): Promise<BrowserTabError> {
  const basic = classifyNavigationError(error)
  if (
    basic.kind === 'unsupported-protocol' ||
    basic.kind === 'site-blocked' ||
    basic.kind === 'tab-view-missing'
  ) return basic
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { kind:'offline', message:t("\u8BBE\u5907\u5F53\u524D\u5904\u4E8E\u79BB\u7EBF\u72B6\u6001\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC\u8FDE\u63A5\u3002")}
  try {
    const result = await diagnoseNativeNavigation(url)
    if (result.kind === 'reachable') return basic
    return { kind: result.kind, message: result.message, httpStatus: result.httpStatus } as BrowserTabError
  } catch { return basic }
}