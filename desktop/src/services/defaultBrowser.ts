import { invoke } from '@tauri-apps/api/core'

/**
 * Default-browser integration (see `src-tauri/src/default_browser.rs`).
 *
 * Windows never lets an app flip the default browser by itself: the choice is
 * user-owned and hash-protected. `registerAsDefaultBrowser` therefore only
 * registers Arcadia as a *candidate* and the caller must send the user to the
 * system page, then re-read the status — `isDefault` reflects what Windows
 * actually resolves, not what was requested.
 */
export interface DefaultBrowserStatus {
  platformSupported: boolean
  isDefault: boolean
  registered: boolean
  currentProgId: string | null
  currentAppName: string | null
}

const isTauri = () => '__TAURI_INTERNALS__' in window

const FALLBACK: DefaultBrowserStatus = {
  platformSupported: false,
  isDefault: false,
  registered: false,
  currentProgId: null,
  currentAppName: null,
}

export async function getDefaultBrowserStatus(): Promise<DefaultBrowserStatus> {
  if (!isTauri()) return FALLBACK
  return invoke<DefaultBrowserStatus>('default_browser_status')
}

/** Registers the per-user ProgID/capabilities entries and returns the new state. */
export async function registerAsDefaultBrowser(): Promise<DefaultBrowserStatus> {
  if (!isTauri()) throw new Error('default browser registration requires the desktop app')
  return invoke<DefaultBrowserStatus>('default_browser_register')
}

/** Opens Windows "Default apps" (focused on Arcadia where the OS supports it). */
export async function openDefaultAppsSettings(): Promise<void> {
  if (!isTauri()) return
  await invoke('default_browser_open_settings')
}

/**
 * Returns (once) the URL the shell passed on the command line when Arcadia was
 * launched as the default browser.
 *
 * The promise is cached because React StrictMode mounts effects twice in
 * development; a second `invoke` would find the slot already empty.
 */
let launchRequest: Promise<string | null> | null = null
let deliveredLaunchUrl: string | null = null

export function takeLaunchUrl(): Promise<string | null> {
  if (!isTauri()) return Promise.resolve(null)
  launchRequest ??= invoke<string | null>('default_browser_take_launch_url').catch(() => null)
  return launchRequest
}

/** Same as {@link takeLaunchUrl}, but yields a URL at most once per process. */
export async function consumeLaunchUrl(): Promise<string | null> {
  const url = await takeLaunchUrl()
  if (!url || deliveredLaunchUrl === url) return null
  deliveredLaunchUrl = url
  return url
}
