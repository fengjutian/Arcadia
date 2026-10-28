/**
 * Shared geometry for the toast stack that the message layer publishes.
 *
 * The browser route renders its page inside a native child WebView, which is
 * painted *above* the React surface. A toast that floats over the page is
 * therefore invisible, and a toast that floats over the app chrome steals the
 * omnibox and the tab strip. The route instead reserves a shelf: the message
 * layer measures itself and publishes `--toast-stack-height`, and the browser
 * surface — the element whose rect defines the native WebView bounds — moves
 * down by exactly that height until the stack empties.
 *
 * Several components can own a message holder at the same time (the root
 * `UIProvider` plus page-level `message.useMessage()` holders). Every holder
 * reports its own height, and the tallest stack wins so the reserved shelf
 * always clears whichever stack is currently on screen.
 */

export const TOAST_STACK_VARIABLE = '--toast-stack-height'

/** Tallest finite height in the stack registry, rounded up to whole pixels. */
export function tallestToastStack(heights: Iterable<number>): number {
  let tallest = 0
  for (const height of heights) {
    if (!Number.isFinite(height)) continue
    if (height > tallest) tallest = height
  }
  return Math.ceil(tallest)
}

/** CSS value for the reserved shelf, or `null` when nothing has to be reserved. */
export function toastStackCssValue(height: number): string | null {
  if (!Number.isFinite(height) || height <= 0) return null
  return `${Math.ceil(height)}px`
}
