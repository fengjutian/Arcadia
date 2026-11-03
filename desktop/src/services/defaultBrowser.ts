import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

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
  const status = await invoke<DefaultBrowserStatus | null>('default_browser_status')
  return status ?? FALLBACK
}

/** Registers the per-user ProgID/capabilities entries and returns the new state. */
export async function registerAsDefaultBrowser(): Promise<DefaultBrowserStatus> {
  if (!isTauri()) throw new Error('default browser registration requires the desktop app')
  const status = await invoke<DefaultBrowserStatus | null>('default_browser_register')
  return status ?? FALLBACK
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

/** Event the Rust side emits when a second launch forwards a URL. */
export const LAUNCH_URL_EVENT = 'arcadia://launch-url'

/**
 * Subscribes to URLs forwarded by a second process. The single-instance
 * plugin already exited that process, so this is the only delivery path for
 * "click a link while Arcadia is running".
 */
export function listenLaunchUrl(handler: (url: string) => void): Promise<UnlistenFn> {
  if (!isTauri()) return Promise.resolve(() => undefined)
  return listen<{ url?: string }>(LAUNCH_URL_EVENT, event => {
    const url = event.payload?.url
    if (url && /^https?:\/\//i.test(url)) handler(url)
  })
}
