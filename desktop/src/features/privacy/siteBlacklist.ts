/**
 * Client-side mirror of the Rust site blacklist.
 *
 * The Rust layer is authoritative: it rejects navigation before a request is
 * issued. This module keeps the list in memory so the browser UI can render the
 * blocked page instantly, label the "封杀此网站" menu item correctly, and run a
 * best-effort check on platforms without a navigation guard.
 *
 * Matching rules must stay in sync with `src-tauri/src/site_blacklist.rs`.
 */
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import {
  siteBlacklistAdd,
  siteBlacklistAddMany,
  siteBlacklistClear,
  siteBlacklistEvents,
  siteBlacklistGetSettings,
  siteBlacklistList,
  siteBlacklistRemove,
  siteBlacklistSetEnabled,
  siteBlacklistSetSettings,
  siteBlacklistSummary,
  type SiteBlacklistEntry,
  type SiteBlacklistEvent,
  type SiteBlacklistImportResult,
  type SiteBlacklistSettings,
  type SiteBlacklistSummary,
} from '../../api'

export const SITE_BLACKLIST_CHANGE_EVENT = 'arcadia-site-blacklist-changed'

const isTauri = () => '__TAURI_INTERNALS__' in window

let entries: SiteBlacklistEntry[] = []
let settings: SiteBlacklistSettings = { enabled: true, blockSubresources: true, updatedAt: 0 }
let loaded = false
let inflight: Promise<void> | null = null

/** Lowercase, strip IPv6 brackets and a trailing root dot. */
export function normalizeHost(value: string): string {
  const trimmed = value.trim().replace(/^\[(.*)\]$/, '$1').replace(/\.+$/, '')
  return trimmed.toLowerCase()
}

/** Hostname for http(s) URLs; null for anything the browser cannot navigate to. */
export function hostFromUrl(value: string): string | null {
  if (!value) return null
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    const host = normalizeHost(parsed.hostname)
    return host || null
  } catch {
    return null
  }
}

/**
 * Pure matcher used by both the cache and unit tests.
 * Mirrors `SiteRules::match_url`: longest rule first, exact host or a dot
 * boundary subdomain when `includeSubdomains` is set.
 */
export function matchSiteBlacklist(
  url: string,
  candidates: SiteBlacklistEntry[],
  enabled = true,
): SiteBlacklistEntry | null {
  if (!enabled) return null
  const host = hostFromUrl(url)
  if (!host) return null
  const ordered = [...candidates]
    .filter(entry => entry.enabled)
    .sort((left, right) => right.host.length - left.host.length)
  for (const entry of ordered) {
    const rule = normalizeHost(entry.host)
    if (!rule) continue
    if (host === rule) return entry
    if (entry.includeSubdomains && host.endsWith(`.${rule}`)) return entry
  }
  return null
}

export async function refreshSiteBlacklist(force = false): Promise<void> {
  if (!isTauri()) {
    loaded = true
    return
  }
  if (loaded && !force) return
  if (inflight) return inflight
  inflight = (async () => {
    const [list, current] = await Promise.all([siteBlacklistList(), siteBlacklistGetSettings()])
    entries = Array.isArray(list) ? list : []
    settings = current
    loaded = true
  })().finally(() => {
    inflight = null
  })
  return inflight
}

export const loadSiteBlacklist = refreshSiteBlacklist

export function getBlacklistEntries(): SiteBlacklistEntry[] {
  return entries
}

export function getBlacklistSettings(): SiteBlacklistSettings {
  return settings
}

export function findBlockingEntry(url: string): SiteBlacklistEntry | null {
  return matchSiteBlacklist(url, entries, settings.enabled)
}

export function notifySiteBlacklistChanged(): void {
  window.dispatchEvent(new CustomEvent(SITE_BLACKLIST_CHANGE_EVENT))
}

async function afterMutation(): Promise<void> {
  await refreshSiteBlacklist(true)
  notifySiteBlacklistChanged()
}

export async function addBlockedSite(input: string, note?: string | null, source = 'manual'): Promise<SiteBlacklistEntry> {
  const entry = await siteBlacklistAdd(input, note ?? null, source)
  await afterMutation()
  return entry
}

export async function addBlockedSites(input: string): Promise<SiteBlacklistImportResult> {
  const result = await siteBlacklistAddMany(input)
  await afterMutation()
  return result
}

export async function removeBlockedSite(id: string): Promise<void> {
  await siteBlacklistRemove(id)
  await afterMutation()
}

export async function setBlockedSiteEnabled(id: string, enabled: boolean): Promise<void> {
  await siteBlacklistSetEnabled(id, enabled)
  await afterMutation()
}

export async function clearBlockedSites(): Promise<number> {
  const removed = await siteBlacklistClear()
  await afterMutation()
  return removed
}

export async function updateBlacklistSettings(enabled: boolean, blockSubresources: boolean): Promise<void> {
  await siteBlacklistSetSettings(enabled, blockSubresources)
  await afterMutation()
}

export async function listBlacklistEvents(limit = 20): Promise<SiteBlacklistEvent[]> {
  return siteBlacklistEvents(limit)
}

export async function blacklistSummary(): Promise<SiteBlacklistSummary> {
  return siteBlacklistSummary()
}

/**
 * Subscribe to local mutations and to Rust-side changes (other windows or a
 * background block). Returns an unsubscribe function.
 */
export async function subscribeSiteBlacklist(listener: () => void): Promise<() => void> {
  const onChange = () => listener()
  window.addEventListener(SITE_BLACKLIST_CHANGE_EVENT, onChange)
  let unlisten: UnlistenFn = () => undefined
  if (isTauri()) {
    try {
      unlisten = await listen('browser://site-blacklist-changed', () => {
        void refreshSiteBlacklist(true).then(listener).catch(() => undefined)
      })
    } catch {
      /* non-Tauri builds replay the window event only */
    }
  }
  return () => {
    window.removeEventListener(SITE_BLACKLIST_CHANGE_EVENT, onChange)
    unlisten()
  }
}
