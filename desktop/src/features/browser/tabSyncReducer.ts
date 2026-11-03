import { t } from '@arcadia/i18n'
import type { BrowserTab } from '../../types'
import type { NativeBrowserState } from '../../services/nativeBrowser'

/**
 * Pure decision tree for the polling state-sync loop the browser runs every
 * 750ms. The hook wrapper in useTabRuntime keeps the polling side effect and
 * just delegates the "what should I do with this poll response?" logic here so
 * it is unit-testable without fake timers.
 */
export type TabSyncDecision =
  | { kind: 'apply'; patch: Partial<BrowserTab>; restoreScroll?: { x: number; y: number } }
  | { kind: 'ignore' }
  | { kind: 'reopen'; failures: 0 }
  | { kind: 'bumpFailure'; failures: number }

export interface TabSyncInputs {
  state: NativeBrowserState | null
  isAlive: boolean
  previousFailures: number
  pendingScroll?: { x: number; y: number }
  fallbackTitle: string
}

const FAILURE_THRESHOLD = 3

/** Build a useful label when a page, especially the built-in PDF viewer, has no title. */
export function fallbackTabTitle(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'file:') {
      const fileName = parsed.pathname.split('/').filter(Boolean).at(-1)
      if (fileName) return decodeURIComponent(fileName)
    }
    return parsed.hostname ||t("新标签页")
  } catch {
    return t("新标签页")
  }
}

export function decideTabSync(inputs: TabSyncInputs): TabSyncDecision {
  const { state, isAlive, previousFailures, pendingScroll, fallbackTitle } = inputs
  if (state) {
    const patch: Partial<BrowserTab> = {
      url: state.url,
      title: state.title || fallbackTitle,
      favicon: state.favicon,
      loading: state.loading,
      scrollX: Math.round(state.scrollX),
      scrollY: Math.round(state.scrollY),
      scrollDepth: state.scrollDepth ?? 0,
      canGoBack: state.canGoBack,
      canGoForward: state.canGoForward,
    }
    const restore = pendingScroll && !state.loading ? pendingScroll : undefined
    return { kind: 'apply', patch, restoreScroll: restore }
  }
  const nextFailures = previousFailures + 1
  if (nextFailures >= FAILURE_THRESHOLD && !isAlive) {
    return { kind: 'reopen', failures: 0 }
  }
  return { kind: 'bumpFailure', failures: nextFailures }
}

/**
 * Exposed so the hook and tests can agree on the recovery threshold. If this
 * number changes we want both to drift together.
 */
export const TAB_SYNC_FAILURE_THRESHOLD = FAILURE_THRESHOLD

/**
 * Fields the poll loop writes into the tab record. Used by the browser page to
 * bail out of a `setTabs` when nothing moved: the 750ms poll used to rebuild
 * the tab object (and re-render the whole page) on every tick.
 */
const SYNCED_TAB_FIELDS: Array<keyof BrowserTab> = [
  'url',
  'title',
  'favicon',
  'loading',
  'scrollX',
  'scrollY',
  'scrollDepth',
  'canGoBack',
  'canGoForward',
  'crashed',
]

/** True when applying `next` over `current` would not change anything visible. */
export function sameSyncedTab(current: BrowserTab, next: BrowserTab): boolean {
  return SYNCED_TAB_FIELDS.every(field => current[field] === next[field])
}