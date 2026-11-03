/**
 * Reader package surface.
 *
 * Turns a captured page snapshot into a cleaned article plus Markdown, and
 * provides the shared text-unit counter used by documents and summaries.
 */

export type { PageSnapshot, ReaderArticle } from './types'
export { extractArticle } from './extractArticle'
export { countTextUnits } from './textCount'
