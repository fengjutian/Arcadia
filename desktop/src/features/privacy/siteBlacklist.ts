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
  siteBlacklistSetScope,
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

interface BlacklistIndex {
  /** `includeSubdomains = false`: only the exact host matches. */
  exact: Map<string, SiteBlacklistEntry>
  /** `includeSubdomains = true`: the host and every parent suffix match. */
  suffix: Map<string, SiteBlacklistEntry>
}

const EMPTY_INDEX: BlacklistIndex = { exact: new Map(), suffix: new Map() }
let index: BlacklistIndex = EMPTY_INDEX

/**
 * Compile the flat list once per change. Lookups then walk at most one entry
 * per label instead of scanning and sorting the whole list on every poll.
 */
function buildIndex(candidates: SiteBlacklistEntry[]): BlacklistIndex {
  const exact = new Map<string, SiteBlacklistEntry>()
  const suffix = new Map<string, SiteBlacklistEntry>()
  for (const entry of candidates) {
    if (!entry.enabled) continue
    const host = normalizeHost(entry.host)
    if (!host) continue
    if (entry.includeSubdomains) suffix.set(host, entry)
    else exact.set(host, entry)
  }
  return { exact, suffix }
}

function lookup(indexToSearch: BlacklistIndex, url: string): SiteBlacklistEntry | null {
  const host = hostFromUrl(url)
  if (!host) return null
  const exactMatch = indexToSearch.exact.get(host)
  if (exactMatch) return exactMatch
  // IP literals have no subdomain hierarchy, matching the Rust matcher.
  if (isIpLiteral(host)) return null
  // a.b.example.com → b.example.com → example.com; the first hit is the
  // longest (most specific) suffix.
  let cursor = host
  while (cursor) {
    const match = indexToSearch.suffix.get(cursor)
    if (match) return match
    const dot = cursor.indexOf('.')
    if (dot < 0) break
    cursor = cursor.slice(dot + 1)
  }
  return null
}

function isIpLiteral(host: string): boolean {
  return host.includes(':') || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)
}

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
 * Mirrors `SiteRules::match_host`: exact rules first, then the longest suffix
 * rule, so a narrow exact rule beats a broader parent rule.
 */
export function matchSiteBlacklist(
  url: string,
  candidates: SiteBlacklistEntry[],
  enabled = true,
): SiteBlacklistEntry | null {
  if (!enabled) return null
  return lookup(buildIndex(candidates), url)
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
    index = buildIndex(entries)
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
  if (!settings.enabled) return null
  return lookup(index, url)
}

export function notifySiteBlacklistChanged(): void {
  window.dispatchEvent(new CustomEvent(SITE_BLACKLIST_CHANGE_EVENT))
}

async function afterMutation(): Promise<void> {
  await refreshSiteBlacklist(true)
  notifySiteBlacklistChanged()
}

export async function addBlockedSite(
  input: string,
  note?: string | null,
  source = 'manual',
  includeSubdomains = true,
): Promise<SiteBlacklistEntry> {
  const entry = await siteBlacklistAdd(input, note ?? null, source, includeSubdomains)
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

export async function setBlockedSiteScope(id: string, includeSubdomains: boolean): Promise<void> {
  await siteBlacklistSetScope(id, includeSubdomains)
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
