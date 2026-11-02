export interface PageWindow {
  /** Current page, clamped to the available range. */
  page: number
  pageCount: number
  /** 1-based index of the first row on the page; 0 when there are no rows. */
  start: number
  /** 1-based index of the last row on the page; 0 when there are no rows. */
  end: number
  /** Page buttons to render, always containing the current page. */
  pages: number[]
}

/**
 * Window of pages around `page` for a paginated list. Kept pure so the search
 * page and its pagination control can never disagree about the visible range.
 */
export function pageWindow(total: number, page: number, pageSize: number, maxButtons = 7): PageWindow {
  const size = Math.max(1, Math.floor(pageSize))
  const count = Math.max(1, Math.ceil(Math.max(0, total) / size))
  const current = Math.min(Math.max(1, Math.floor(page) || 1), count)
  if (total <= 0) return { page: 1, pageCount: 1, start: 0, end: 0, pages: [1] }

  const start = (current - 1) * size + 1
  const end = Math.min(current * size, total)
  const buttons = Math.max(1, Math.min(maxButtons, count))
  const first = Math.max(1, Math.min(current - Math.floor(buttons / 2), count - buttons + 1))
  const pages = Array.from({ length: buttons }, (_, index) => first + index)
  return { page: current, pageCount: count, start, end, pages }
}
