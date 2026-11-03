/**
 * How the message layer folds repeated notifications into one row.
 *
 * The browser menu, the reader and the download centre can all fail the same
 * way on every attempt (`菜单浮层加载失败，请重启桌面应用后重试` fired once per
 * click in the screenshot that triggered this work). A stack of identical rows
 * carries no extra information, and on the browser route every extra row pushes
 * the page further down, so a repeated message replaces the row it duplicates
 * instead of stacking under it.
 */

/** Rows the layer is willing to show at once; the newest win. */
export const MAX_VISIBLE_TOASTS = 3

/**
 * Identity used to fold repeats. Only plain text can be compared safely —
 * arbitrary React nodes may look identical but carry different state, so they
 * keep their own row.
 */
export function repeatedContentKey(content: unknown): string | undefined {
  return typeof content === 'string' && content.length > 0 ? content : undefined
}

/** Keeps the newest entries, dropping the oldest beyond `MAX_VISIBLE_TOASTS`. */
export function trimToVisible<T>(rows: T[]): T[] {
  return rows.length <= MAX_VISIBLE_TOASTS ? rows : rows.slice(rows.length - MAX_VISIBLE_TOASTS)
}
