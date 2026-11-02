import { ragSyncExtras } from '../../api'

/**
 * Debounced incremental embedding for notes / clips / archive entries.
 *
 * Saving a highlight should not fire an embedding request per keystroke: the
 * first change schedules a pass a few seconds later, later changes inside the
 * window collapse into it. Failures stay silent — semantic recall is an
 * enhancement, never a blocker for saving.
 */
let timer: number | null = null

export function scheduleExtrasSync(delayMs = 4_000): void {
  if (typeof window === 'undefined') return
  if (timer !== null) window.clearTimeout(timer)
  timer = window.setTimeout(() => {
    timer = null
    void ragSyncExtras().catch(() => 0)
  }, delayMs)
}
