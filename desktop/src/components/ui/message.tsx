import { CheckCircle2, CircleAlert, Info, LoaderCircle, TriangleAlert, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { repeatedContentKey, trimToVisible } from './toastPolicy'
import { activeToastSink } from './toastSink'

type MessageType = 'success' | 'error' | 'info' | 'warning' | 'loading'
interface MessageConfig { key?: string; type?: MessageType; content: ReactNode; duration?: number }
interface Toast extends MessageConfig { id: string; type: MessageType; repeated?: string }
interface MessageApi { open: (config: MessageConfig) => void; success: (content: ReactNode, duration?: number) => void; error: (content: ReactNode, duration?: number) => void; info: (content: ReactNode, duration?: number) => void; warning: (content: ReactNode, duration?: number) => void; loading: (content: ReactNode, duration?: number) => void; destroy: (key?: string) => void }

const EVENT = 'arcadia-ui-message'
const icons = { success: <CheckCircle2/>, error: <CircleAlert/>, info: <Info/>, warning: <TriangleAlert/>, loading: <LoaderCircle className="ui-icon-spin"/> }

/** Matches the palette the injected in-page toast uses, so both surfaces agree. */
function currentTheme(): 'light' | 'dark' {
  return document.body.dataset.theme === 'dark' ? 'dark' : 'light'
}

// The layer is portalled to `body` so a route-level stacking context (see
// `.route-view`'s entry animation) can never repaint it underneath the window
// chrome. When the browser route has a live page it registers a sink
// (`components/ui/toastSink.ts`) and plain-text toasts are painted inside that
// page instead: the page is a native child WebView painted above this layer, so
// a host toast over it would be invisible and a host toast above it would have
// to move the WebView out of the way.
function useToastStore(): [MessageApi, ReactNode] {
  const [toasts, setToasts] = useState<Toast[]>([])
  // Ids handed to a toast sink; only those need a `hide` on dismissal, so the
  // host path never sends a pointless IPC call for its own rows.
  const injected = useRef(new Set<string>())
  const remove = useCallback((id: string) => {
    if (injected.current.delete(id)) activeToastSink()?.hide(id)
    setToasts(items => items.filter(item => item.id !== id))
  }, [])
  const push = useCallback((config: MessageConfig, id: string, type: MessageType) => {
    // A repeated text message replaces its predecessor instead of stacking.
    const repeated = config.key ? undefined : repeatedContentKey(config.content)
    setToasts(items => trimToVisible([
      ...items.filter(item => item.id !== id && !(repeated !== undefined && item.repeated === repeated)),
      { ...config, id, repeated, type },
    ]))
    if (config.duration !== 0) window.setTimeout(() => remove(id), (config.duration ?? 3) * 1000)
  }, [remove])
  const trackInjected = useCallback((id: string, durationMs: number) => {
    injected.current.add(id)
    // The page removes its own row when the timer fires; drop the id here too so
    // a long session cannot accumulate ids that no longer exist anywhere.
    if (durationMs > 0) window.setTimeout(() => injected.current.delete(id), durationMs + 500)
  }, [])
  const open = useCallback((config: MessageConfig) => {
    const id = config.key ?? crypto.randomUUID()
    const type = config.type ?? 'info'
    const durationMs = (config.duration ?? 3) * 1000
    const sink = activeToastSink()
    // Only plain text can cross into the page; anything else stays in the host
    // layer, which is where host-rendered surfaces (new tab, error, reader)
    // show their messages anyway.
    if (sink && typeof config.content === 'string') {
      const delivered = sink.show({ id, kind: type, text: config.content, durationMs, theme: currentTheme() })
      if (delivered === true) { trackInjected(id, durationMs); return }
      if (typeof delivered !== 'boolean') {
        trackInjected(id, durationMs)
        void delivered.then(accepted => {
          if (accepted) return
          injected.current.delete(id)
          push(config, id, type)
        }, () => {
          injected.current.delete(id)
          push(config, id, type)
        })
        return
      }
    }
    push(config, id, type)
  }, [push, trackInjected])
  const api = useMemo<MessageApi>(() => ({
    open,
    success: (content, duration) => open({ content, duration, type: 'success' }),
    error: (content, duration) => open({ content, duration, type: 'error' }),
    info: (content, duration) => open({ content, duration, type: 'info' }),
    warning: (content, duration) => open({ content, duration, type: 'warning' }),
    loading: (content, duration = 0) => open({ content, duration, type: 'loading' }),
    destroy: key => {
      if (key) { remove(key); return }
      const sink = activeToastSink()
      injected.current.forEach(id => sink?.hide(id))
      injected.current.clear()
      setToasts([])
    },
  }), [open, remove])
  const layer = <div className="ui-message-layer" aria-live="polite">{toasts.map(toast => <div className={`ui-message ui-message--${toast.type}`} key={toast.id}><span>{icons[toast.type]}</span><div>{toast.content}</div><button type="button" aria-label="关闭" onClick={() => remove(toast.id)}><X size={14}/></button></div>)}</div>
  return [api, createPortal(layer, document.body)]
}

function emit(type: MessageType, content: ReactNode, duration?: number) { window.dispatchEvent(new CustomEvent<MessageConfig>(EVENT, { detail: { type, content, duration } })) }

export const message = { useMessage: useToastStore, open: (config: MessageConfig) => window.dispatchEvent(new CustomEvent<MessageConfig>(EVENT, { detail: config })), success: (content: ReactNode, duration?: number) => emit('success', content, duration), error: (content: ReactNode, duration?: number) => emit('error', content, duration), info: (content: ReactNode, duration?: number) => emit('info', content, duration), warning: (content: ReactNode, duration?: number) => emit('warning', content, duration), loading: (content: ReactNode, duration?: number) => emit('loading', content, duration) }

export function UIProvider({ children }: { children: ReactNode }) {
  const [api, holder] = useToastStore()
  useEffect(() => {
    const receive = (event: Event) => api.open((event as CustomEvent<MessageConfig>).detail)
    window.addEventListener(EVENT, receive)
    return () => window.removeEventListener(EVENT, receive)
  }, [api])
  return <>{children}{holder}</>
}
