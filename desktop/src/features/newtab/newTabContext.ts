/**
 * New-tab "research desk" model.
 *
 * The first screen should answer "where am I and what is in flight?", not show
 * a portal. This pure builder keeps the layout decision testable: the component
 * only maps cards to markup and the empty state stays explicit.
 */

export interface NewTabDocumentRef {
  id: string
  title: string
}

export type NewTabContextCard =
  | { key: 'space'; name: string }
  | { key: 'queue'; count: number }
  | { key: 'recent'; documents: NewTabDocumentRef[] }
  | { key: 'today'; visits: number; sites: number }

export interface NewTabContext {
  cards: NewTabContextCard[]
  isEmpty: boolean
}

export const NEW_TAB_RECENT_LIMIT = 3

export function buildNewTabContext(input: {
  spaceName: string | null | undefined
  queuedCount: number
  documents: ReadonlyArray<NewTabDocumentRef>
  todayVisits?: number
  todaySites?: number
}): NewTabContext {
  const cards: NewTabContextCard[] = []
  const name = input.spaceName?.trim()
  if (name) cards.push({ key: 'space', name })
  if (input.queuedCount > 0) cards.push({ key: 'queue', count: input.queuedCount })
  const recent = input.documents.slice(0, NEW_TAB_RECENT_LIMIT).map(document => ({ id: document.id, title: document.title || document.id }))
  if (recent.length > 0) cards.push({ key: 'recent', documents: recent })
  if ((input.todayVisits ?? 0) > 0) cards.push({ key: 'today', visits: input.todayVisits!, sites: input.todaySites ?? 0 })
  return { cards, isEmpty: cards.length === 0 }
}
