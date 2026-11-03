/**
 * Browser-domain types.
 *
 * These used to live in `desktop/src/types.ts`. They are part of the browser
 * package because every tab, session, workspace and suggestion module needs
 * them; the desktop app re-exports them so existing imports keep working.
 */

export interface BrowserTab {
  id: string
  url: string
  title: string
  titleLocked?: boolean
  favicon?: string
  loading: boolean
  active: boolean
  pinned: boolean
  private?: boolean
  muted?: boolean
  audible?: boolean
  crashed?: boolean
  groupId?: string
  suspended?: boolean
  suspendedReason?: 'lru' | 'manual'
  scrollX?: number
  scrollY?: number
  scrollDepth?: number
  canGoBack?: boolean
  canGoForward?: boolean
  error?: BrowserTabError
  lastActiveAt?: number
}

export type BrowserTabError = {
  kind:
    | 'load-failed'
    | 'web-mode-required'
    | 'unsupported-protocol'
    | 'offline'
    | 'dns'
    | 'timeout'
    | 'tls'
    | 'connection-refused'
    | 'network'
    | 'http-client'
    | 'http-server'
    | 'site-blocked'
    | 'tab-view-missing'
  message: string
  httpStatus?: number
  host?: string
  ruleHost?: string
  entryId?: string
}

/**
 * One visit in the address-bar history. Structurally identical to the
 * app-level history entry so both sides can pass values without adapters.
 */
export interface HistoryEntry {
  url: string
  title: string
  visitedAt: number
}
