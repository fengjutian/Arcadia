import { useCallback, useEffect, useReducer, useRef } from 'react'
import { onPermissionRequest, type PermissionRequest } from '../../services/nativeBrowser'
import { respondPermissionRequest } from '../../services/permissions'
import { getRule, setKind, type SitePermissionKind, type SitePermissionRule, type SitePermissionValue, writeSitePermissions, readSitePermissions } from './sitePermissions'
import { permissionPromptQueueReducer } from './permissionPromptQueue'

export type PermissionDecision = 'allow-once' | 'allow-always' | 'deny-once' | 'deny-always'

export interface PermissionPromptProps {
  /** When false, the host silently denies every pending request. */
  enabled?: boolean
  /** Fired after the user makes a decision (for telemetry). */
  onDecided?: (request: PermissionRequest, decision: PermissionDecision) => void
}

export interface UsePermissionPromptResult {
  pending: PermissionRequest | null
  /** Resolve the current prompt and persist rules if scope is "always". */
  decide: (decision: PermissionDecision) => Promise<void>
}

/**
 * Drives the address-bar permission prompt. Listens to
 * `browser://permission-request` from any child WebView, queues requests and
 * shows them one at a time in the inline bar, and replies via the Rust
 * `browser_permission_respond` command. Requests time out after 15 s on the
 * WebView side, so a queued prompt that is never answered is harmless.
 */
export function usePermissionPrompt(options: PermissionPromptProps = {}): UsePermissionPromptResult {
  const { enabled = true, onDecided } = options
  const [queue, dispatch] = useReducer(permissionPromptQueueReducer, [])
  // Index 0 is the visible prompt; the rest wait their turn.
  const pending = queue[0] ?? null
  const handledRequestIdRef = useRef<string | null>(null)
  const onDecidedRef = useRef(onDecided)
  onDecidedRef.current = onDecided

  useEffect(() => {
    if (!enabled) return
    let disposed = false
    let unlisten: (() => void) | undefined
    void onPermissionRequest(request => {
      if (disposed) return
      dispatch({ type: 'enqueue', request })
    }).then(stop => {
      if (disposed) stop()
      else unlisten = stop
    })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [enabled])

  const decide = useCallback(async (decision: PermissionDecision) => {
    if (!pending) return
    // A double click can fire before React re-renders with the next prompt.
    // Never answer the same request twice.
    if (handledRequestIdRef.current === pending.requestId) return
    handledRequestIdRef.current = pending.requestId
    const request = pending
    dispatch({ type: 'dismiss', requestId: request.requestId })

    const allow = decision === 'allow-once' || decision === 'allow-always'
    const persistValue = shouldPersistPermissionDecision(request, decision)
    if (persistValue) {
      const next = setKind(request.origin, request.kind as SitePermissionKind, persistValue)
      writeSitePermissions(next)
    }
    try {
      await respondPermissionRequest(request.requestId, allow)
    } catch {
      // Network-level failure is non-fatal; the WebView's 15 s timeout will
      // deny the call and the user can retry by triggering the API again.
    }
    onDecidedRef.current?.(request, decision)
  }, [pending])

  return { pending, decide }
}

/**
 * Resolve which rule (if any) an "always" decision should persist.
 *
 * Private tabs deliberately never write to the shared permission store:
 * otherwise browsing incognito would mutate (or leak) the rules used by
 * normal tabs.
 */
export function shouldPersistPermissionDecision(
  request: Pick<PermissionRequest, 'kind' | 'private'>,
  decision: PermissionDecision,
): SitePermissionValue | null {
  if (request.private) return null
  if (!isSitePermissionKind(request.kind)) return null
  if (decision === 'allow-always') return 'allow'
  if (decision === 'deny-always') return 'deny'
  return null
}

/**
 * The host can pre-empt the prompt when the user has already chosen
 * "always allow" or "always deny" in a previous session. This helper is
 * invoked from the inline bar so the UI can stay in sync with the rules
 * that `setKind` just persisted.
 */
export function describeRule(origin: string, kind: SitePermissionKind): SitePermissionValue {
  const rule: SitePermissionRule | null = getRule(origin)
  return rule ? rule[kind] : 'ask'
}

/**
 * Compose origin + kind into a human label for the inline prompt.
 */
export function describePrompt(request: PermissionRequest): { origin: string; kind: string; kindLabel: string; originLabel: string } {
  const kindLabel = PERMISSION_LABELS[request.kind] ?? request.kind
  return {
    origin: request.origin,
    kind: request.kind,
    kindLabel,
    originLabel: originDisplay(request.origin),
  }
}

const PERMISSION_LABELS: Record<PermissionRequest['kind'], string> = {
  camera: '摄像头',
  microphone: '麦克风',
  location: '定位',
  notifications: '通知',
  clipboard: '剪贴板读取',
  media: '摄像头 + 麦克风',
}

function originDisplay(origin: string): string {
  try {
    const url = new URL(origin)
    return url.hostname || origin
  } catch {
    return origin
  }
}

function isSitePermissionKind(kind: string): kind is SitePermissionKind {
  return kind === 'camera' || kind === 'microphone' || kind === 'location' || kind === 'notifications' || kind === 'clipboard'
}

/**
 * Force-deny every kind for the given origin in the *shared* rule store.
 *
 * This mutates persisted user rules, so it must only be called from an
 * explicit user action. Private tabs must never call it: doing so overwrote
 * (and later deleted) the rules used by normal tabs.
 */
export function forceAllDenyFor(origin: string): void {
  const all = readSitePermissions()
  const rule = all.find(item => item.origin === origin)
  if (!rule) return
  writeSitePermissions(all.map(item => item.origin === origin ? {
    ...item,
    camera: 'deny',
    microphone: 'deny',
    location: 'deny',
    notifications: 'deny',
    clipboard: 'deny',
  } : item))
}

export function resetOrigin(origin: string): void {
  writeSitePermissions(readSitePermissions().filter(rule => rule.origin !== origin))
}