/**
 * Space switching on top of the existing `workspaces` table.
 *
 * A Space is a named tab set. Switching never drops unsaved tabs: the browser
 * route saves the current tab strip as an auto-named workspace before it loads
 * the target one. The shell listens for `SPACE_CHANGED_EVENT` to keep the rail
 * chip in sync, while the browser route owns tab access.
 */

export const SPACE_RESTORE_EVENT = 'arcadia-space-restore'
export const SPACE_SAVE_EVENT = 'arcadia-space-save'
export const SPACE_CHANGED_EVENT = 'arcadia-space-changed'
export const SPACE_SCOPE_EVENT = 'arcadia-space-scope-changed'
export const SPACE_STORAGE_KEY = 'arcadia.space.current.v1'
export const SPACE_SCOPE_STORAGE_KEY = 'arcadia.space.scope.v1'

export interface CurrentSpace {
  id: string
  name: string
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** Auto-save name used when switching away from unsaved tabs. */
export function autoSpaceName(date: Date): string {
  return `自动保存 ${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function readCurrentSpace(): CurrentSpace | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(SPACE_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const record = parsed as Record<string, unknown>
    if (typeof record.id !== 'string' || typeof record.name !== 'string') return null
    if (!record.id.trim() || !record.name.trim()) return null
    return { id: record.id, name: record.name }
  } catch {
    return null
  }
}

export function writeCurrentSpace(space: CurrentSpace | null): void {
  if (typeof localStorage === 'undefined') return
  try {
    if (!space) localStorage.removeItem(SPACE_STORAGE_KEY)
    else localStorage.setItem(SPACE_STORAGE_KEY, JSON.stringify(space))
  } catch { /* storage full: the rail chip falls back to the generic label */ }
}

export function dispatchSpaceRestore(id: string): void {
  if (typeof window === 'undefined' || !id) return
  window.dispatchEvent(new CustomEvent(SPACE_RESTORE_EVENT, { detail: { id } }))
}

export function dispatchSpaceSave(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(SPACE_SAVE_EVENT))
}

/** Space id -> knowledge collection id. An absent entry means "all knowledge". */
export function readSpaceScopes(): Record<string, string> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(SPACE_SCOPE_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const scopes: Record<string, string> = {}
    for (const [spaceId, collectionId] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof collectionId === 'string' && collectionId.trim()) scopes[spaceId] = collectionId
    }
    return scopes
  } catch {
    return {}
  }
}

export function writeSpaceScope(spaceId: string, collectionId: string | null): void {
  if (typeof localStorage === 'undefined' || !spaceId) return
  try {
    const scopes = readSpaceScopes()
    if (collectionId) scopes[spaceId] = collectionId
    else delete scopes[spaceId]
    localStorage.setItem(SPACE_SCOPE_STORAGE_KEY, JSON.stringify(scopes))
  } catch { /* storage full: scope stays per-session */ }
}

/** Collection the active Space is bound to, or null for the whole library. */
export function activeCollectionId(space: CurrentSpace | null = readCurrentSpace()): string | null {
  if (!space) return null
  return readSpaceScopes()[space.id] ?? null
}
