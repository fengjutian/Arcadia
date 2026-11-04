/**
 * Tauri commands owned by the browser domain.
 *
 * Keeping these here (instead of in the app-wide `api.ts`) is what lets
 * `@arcadia/browser-core` ship without importing the desktop application.
 */

import { invoke } from '@tauri-apps/api/core'
import type { SitePermissionRule, SitePermissionKind } from './sitePermissionTypes'

const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

const PERMISSION_KINDS: SitePermissionKind[] = ['camera', 'microphone', 'location', 'notifications', 'clipboard']

/**
 * Mirror the localStorage permission rules into SQLite so the native
 * permission guards can answer before any page script runs.
 */
export async function replaceSitePermissions(rules: SitePermissionRule[]): Promise<void> {
  if (!isTauri()) return
  const permissions = rules.flatMap(rule =>
    PERMISSION_KINDS.map(permissionKind => ({
      origin: rule.origin,
      permissionKind,
      decision: rule[permissionKind],
    })),
  )
  await invoke('local_replace_site_permissions', { permissions })
}
