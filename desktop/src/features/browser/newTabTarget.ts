/**
 * Rules for turning a "open this URL in a new tab" request into tab state.
 *
 * Two browser behaviours look identical to a user but must not be confused:
 *
 * 1. A link/page asking for a new window (`target=_blank`, middle-click,
 *    Ctrl+click, `window.open`) always carries a real URL. Anything else the
 *    platform reports (`about:blank` preload windows, share/login popups that
 *    never receive a location) is not a link and must never materialise as a
 *    blank tab next to the page the user asked for.
 * 2. When the active tab is still an untouched new-tab page, the page the user
 *    is opening belongs *there*: reusing it keeps the strip at one tab instead
 *    of leaving an empty "新标签页" behind.
 *
 * Both helpers are pure so the tab-strip behaviour can be tested without a
 * WebView.
 */
import type { BrowserTab } from '../../types'

/** Only real navigations may create a tab; popups without a URL do not. */
export function isPageNewWindowUrl(url: unknown): url is string {
  return typeof url === 'string' && /^https?:\/\//i.test(url.trim())
}

/**
 * A tab the user has not used yet: no URL, no load in flight, no error and no
 * pinned/suspended state. Only these may be replaced by an incoming page.
 */
export function isPristineNewTab(tab: BrowserTab | null | undefined): boolean {
  if (!tab) return false
  if (tab.url.trim() !== '') return false
  return !tab.loading && !tab.error && !tab.crashed && !tab.pinned && !tab.suspended
}

export interface NewTabOpenOptions {
  background?: boolean
  private?: boolean
}

/**
 * Id of the blank tab an incoming URL should reuse, if any. Background
 * captures and private tabs never reuse a normal new tab: they need their own
 * WebView/profile.
 */
export function reusableNewTabId(
  tabs: readonly BrowserTab[],
  activeTabId: string | undefined,
  options: NewTabOpenOptions = {},
): string | undefined {
  if (options.background === true || options.private === true) return undefined
  if (!activeTabId) return undefined
  const active = tabs.find(tab => tab.id === activeTabId)
  if (!active || active.private === true) return undefined
  return isPristineNewTab(active) ? active.id : undefined
}
