import { useEffect, useState } from 'react'
import { listCollectionDocumentIds } from '../../api'
import { SPACE_CHANGED_EVENT, SPACE_SCOPE_EVENT, activeCollectionId } from './spaces'

/**
 * Document ids allowed by the active Space's knowledge scope.
 *
 * `null` means "all knowledge" (no Space bound, or the lookup failed). Pages use
 * it as an optional filter so the whole app agrees on what the current Space can
 * see.
 */
export function useSpaceCollectionFilter(): ReadonlySet<string> | null {
  const [ids, setIds] = useState<ReadonlySet<string> | null>(null)

  useEffect(() => {
    let alive = true
    const load = async () => {
      const collectionId = activeCollectionId()
      if (!collectionId) {
        if (alive) setIds(null)
        return
      }
      try {
        const scoped = await listCollectionDocumentIds(collectionId)
        if (alive) setIds(new Set(scoped))
      } catch {
        if (alive) setIds(null)
      }
    }
    void load()
    window.addEventListener(SPACE_CHANGED_EVENT, load)
    window.addEventListener(SPACE_SCOPE_EVENT, load)
    return () => {
      alive = false
      window.removeEventListener(SPACE_CHANGED_EVENT, load)
      window.removeEventListener(SPACE_SCOPE_EVENT, load)
    }
  }, [])

  return ids
}
