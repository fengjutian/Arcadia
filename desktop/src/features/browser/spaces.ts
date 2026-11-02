import { t } from '../../i18n'

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
/**
 * Space-menu hand-off between the shell (rail button, `AppLayout`) and the
 * browser route. The page is a native child WebView that paints above the host
 * document, so the menu is drawn inside the page by Rust; these events carry
 * the rows in and the chosen key back out.
 */
export const SPACE_MENU_OPEN_EVENT = 'arcadia-space-menu-open'
export const SPACE_MENU_ACTION_EVENT = 'arcadia-space-menu-action'
export const SPACE_MENU_FALLBACK_EVENT = 'arcadia-space-menu-fallback'
/** Whether a native page currently covers the content area (`detail: boolean`). */
export const SPACE_SURFACE_EVENT = 'arcadia-space-native-surface'
export const SPACE_STORAGE_KEY = 'arcadia.space.current.v1'
export const SPACE_SCOPE_STORAGE_KEY = 'arcadia.space.scope.v1'
export const SPACE_IDENTITY_STORAGE_KEY = 'arcadia.space.identity.v1'

export interface SpaceIdentity {
  color?: string
  icon?: string
}

export const SPACE_ICONS = ['🌱', '🔬', '📚', '🧭', '🎨', '💼'] as const

export const SPACE_COLORS = [
  { value: '#3c8a5c', label: t('绿色') },
  { value: '#3b6fd4', label: t('蓝色') },
  { value: '#8a5cd6', label: t('紫色') },
  { value: '#d4823b', label: t('橙色') },
  { value: '#d14b6a', label: t('红色') },
  { value: '#6b7280', label: t('灰色') },
] as const

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

/** A document passes the Space scope when no scope is set or it is listed. */
export function documentInScope(scope: ReadonlySet<string> | null, documentId: string): boolean {
  return scope === null || scope.has(documentId)
}

/**
 * Namespace for state that should survive per Space (AI conversations,
 * search context). Falls back to `default` when no Space is active so the
 * pre-Space conversation stays reachable.
 */
export function currentSpaceNamespace(): string {
  return readCurrentSpace()?.id ?? 'default'
}

/** Leave Space mode; the rail chip and conversation return to `default`. */
export function clearCurrentSpace(): void {
  writeCurrentSpace(null)
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(SPACE_CHANGED_EVENT, { detail: null }))
}

export function readSpaceIdentities(): Record<string, SpaceIdentity> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(SPACE_IDENTITY_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const known = new Set<string>(SPACE_COLORS.map(color => color.value))
    const knownIcons = new Set<string>(SPACE_ICONS)
    const identities: Record<string, SpaceIdentity> = {}
    for (const [spaceId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue
      const record = value as Record<string, unknown>
      const identity: SpaceIdentity = {}
      if (typeof record.color === 'string' && known.has(record.color)) identity.color = record.color
      if (typeof record.icon === 'string' && knownIcons.has(record.icon)) identity.icon = record.icon
      if (identity.color || identity.icon) identities[spaceId] = identity
    }
    return identities
  } catch {
    return {}
  }
}

export function writeSpaceIdentity(spaceId: string, identity: SpaceIdentity | null): void {
  if (typeof localStorage === 'undefined' || !spaceId) return
  try {
    const identities = readSpaceIdentities()
    const next: SpaceIdentity = {}
    if (identity?.color && SPACE_COLORS.some(color => color.value === identity.color)) next.color = identity.color
    if (identity?.icon && SPACE_ICONS.some(icon => icon === identity.icon)) next.icon = identity.icon
    if (next.color || next.icon) identities[spaceId] = next
    else delete identities[spaceId]
    localStorage.setItem(SPACE_IDENTITY_STORAGE_KEY, JSON.stringify(identities))
  } catch { /* storage full: identity stays per-session */ }
}

export function spaceColorFor(spaceId: string | null | undefined): string | null {
  if (!spaceId) return null
  return readSpaceIdentities()[spaceId]?.color ?? null
}

export function spaceIconFor(spaceId: string | null | undefined): string | null {
  if (!spaceId) return null
  return readSpaceIdentities()[spaceId]?.icon ?? null
}

/**
 * Fingerprints of tab sets that were already auto-saved before a Space switch.
 *
 * Switching Spaces replaces the tab strip, so the app snapshots the outgoing
 * tabs first. Without this index every switch (and every repeat click on the
 * same Space) added another "自动保存 HH:MM" row; with it, a tab set is saved at
 * most once and the Space menu stops filling with duplicates.
 */
export const SPACE_AUTOSAVE_INDEX_KEY = 'arcadia.space.autosave-index.v1'
const AUTOSAVE_INDEX_LIMIT = 80

/** Stable fingerprint of a tab set: URLs, titles and pinned state, in order. */
export function tabSnapshotSignature(payload: { tabs?: unknown[] } | null | undefined): string {
  const tabs = Array.isArray(payload?.tabs) ? payload.tabs : []
  if (tabs.length === 0) return ''
  const normalized = tabs.map(item => {
    const record = item && typeof item === 'object' ? item as Record<string, unknown> : {}
    const url = typeof record.url === 'string' ? record.url : ''
    const title = typeof record.title === 'string' ? record.title : ''
    return `${url}\u0000${title}\u0000${record.pinned === true ? '1' : '0'}`
  }).join('\u0001')
  // FNV-1a, just enough to keep localStorage small.
  let hash = 0x811c9dc5
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function readAutoSaveIndex(): Record<string, string> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(SPACE_AUTOSAVE_INDEX_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const index: Record<string, string> = {}
    for (const [signature, id] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof id === 'string' && id) index[signature] = id
    }
    return index
  } catch {
    return {}
  }
}

export function hasAutoSavedSnapshot(signature: string): boolean {
  if (!signature) return false
  return Boolean(readAutoSaveIndex()[signature])
}

export function rememberAutoSavedSnapshot(signature: string, workspaceId: string): void {
  if (typeof localStorage === 'undefined' || !signature || !workspaceId) return
  try {
    const index = readAutoSaveIndex()
    index[signature] = workspaceId
    const entries = Object.entries(index).slice(-AUTOSAVE_INDEX_LIMIT)
    localStorage.setItem(SPACE_AUTOSAVE_INDEX_KEY, JSON.stringify(Object.fromEntries(entries)))
  } catch { /* storage full: a duplicate snapshot may reappear */ }
}
