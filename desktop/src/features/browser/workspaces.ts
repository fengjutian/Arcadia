import { t } from '../../i18n'
/**
 * Pure helpers for the workspace UI. The Rust commands do the real I/O; this
 * module just shapes inputs (name/description validation) and normalises the
 * display row list.
 */

import { deleteWorkspace, listWorkspaces, saveWorkspace, type WorkspaceSummary } from '../../services/workspaces'

export interface WorkspaceDisplayRow extends WorkspaceSummary {
  /** Friendly wait time, e.g. "刚刚" / "3 分钟前". */
  relativeUpdated: string
  /** True when the workspace holds zero captured tabs. */
  isEmpty: boolean
}

/**
 * Map the most recent update timestamp into a friendly relative string.
 * Uses the same minute / hour bucketing as the download queue so the UI feels
 * consistent.
 */
export function relativeUpdatedAt(updatedAt: string, now: number = Date.now()): string {
  const parsed = Date.parse(updatedAt)
  if (!Number.isFinite(parsed)) return updatedAt
  const diff = Math.max(0, now - parsed)
  if (diff < 60_000) return t("\u521A\u521A")
  const min = Math.floor(diff / 60_000)
  if (min < 60) return t("{value0} \u5206\u949F\u524D",{value0:min})
  const hr = Math.floor(min / 60)
  if (hr < 24) return t("{value0} \u5C0F\u65F6\u524D",{value0:hr})
  const day = Math.floor(hr / 24)
  if (day < 30) return t("{value0} \u5929\u524D",{value0:day})
  return updatedAt.slice(0, 10)
}

export function decorateSummaries(items: WorkspaceSummary[], now: number = Date.now()): WorkspaceDisplayRow[] {
  return items.map(        (item



   )                    =>( {...item,relativeUpdated:relativeUpdatedAt(item.updatedAt,now),isEmpty:item.tabCount<=0,}))
}

const NAME_MAX = 80
const DESC_MAX = 240

/**
 * Cross-component restore request. SettingsPage dispatches this event when
 * the user clicks "恢复" in the workspace editor; BrowserPage listens and
 * performs the actual tab swap.
 */
export const WORKSPACE_RESTORE_EVENT = 'arcadia-workspace-restore'

export interface WorkspaceValidationResult {
  ok: boolean
  reason?: string
}

/** Strict name validation (non-empty after trim, max 80 chars). */
export function validateWorkspaceName(name: string): WorkspaceValidationResult {
  const trimmed = name.trim()
  if (trimmed.length === 0) return { ok: false, reason:t("\u540D\u79F0\u4E0D\u80FD\u4E3A\u7A7A")}
  if ([...trimmed].length > NAME_MAX) return { ok: false, reason:t("\u540D\u79F0\u6700\u591A {value0} \u4E2A\u5B57\u7B26",{value0:NAME_MAX})}
  return { ok: true }
}

/** Optional description validation (max 240 chars). */
export function validateWorkspaceDescription(description: string): WorkspaceValidationResult {
  if ([...description].length > DESC_MAX) return { ok: false, reason:t("\u63CF\u8FF0\u6700\u591A {value0} \u4E2A\u5B57\u7B26",{value0:DESC_MAX})}
  return { ok: true }
}

export { listWorkspaces, saveWorkspace, deleteWorkspace }
export type { WorkspaceSummary }