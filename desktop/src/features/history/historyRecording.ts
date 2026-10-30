/**
 * Decides when the active tab should be written to browsing history.
 *
 * The old logic recorded as soon as the URL changed, which happened while the
 * omnibox value was still the tab title ("github.com", "正在加载…"). Waiting
 * until loading finishes means the entry is written once with the real page
 * title instead of being stuck with the raw input forever.
 */
export interface HistoryCandidate {
  url: string
  title: string
  loading?: boolean
  error?: unknown
  private?: boolean
}

export function shouldRecordHistory(candidate: HistoryCandidate, lastRecordedUrl: string): boolean {
  if (candidate.private) return false
  if (!/^https?:\/\//i.test(candidate.url)) return false
  if (candidate.url === lastRecordedUrl) return false
  // Errors expose an error page, not the requested document.
  if (candidate.error) return false
  // Wait for the first `browser_state` poll to supply the real title.
  if (candidate.loading) return false
  return true
}
