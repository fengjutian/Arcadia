import { CheckCircle2, CircleAlert, Info, LoaderCircle, TriangleAlert, X } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { TOAST_STACK_VARIABLE, tallestToastStack, toastStackCssValue } from './toastStack'
import { repeatedContentKey, trimToVisible } from './toastPolicy'

type MessageType = 'success' | 'error' | 'info' | 'warning' | 'loading'
interface MessageConfig { key?: string; type?: MessageType; content: ReactNode; duration?: number }
interface Toast extends MessageConfig { id: string; type: MessageType; repeated?: string }
interface MessageApi { open: (config: MessageConfig) => void; success: (content: ReactNode, duration?: number) => void; error: (content: ReactNode, duration?: number) => void; info: (content: ReactNode, duration?: number) => void; warning: (content: ReactNode, duration?: number) => void; loading: (content: ReactNode, duration?: number) => void; destroy: (key?: string) => void }

const EVENT = 'arcadia-ui-message'
const icons = { success: <CheckCircle2/>, error: <CircleAlert/>, info: <Info/>, warning: <TriangleAlert/>, loading: <LoaderCircle className="ui-icon-spin"/> }

// Every mounted message holder reports the height of its own stack; the tallest
// stack wins so the browser route reserves a shelf big enough for whichever
// holder is currently showing toasts. The layer itself is portalled to `body`
// so a route-level stacking context (see `.route-view`'s entry animation) can
// never repaint it underneath the window chrome.
const stackHeights = new Map<string, number>()

function publishStackHeight() {
  const cssValue = toastStackCssValue(tallestToastStack(stackHeights.values()))
  const root = document.documentElement
  if (cssValue) root.style.setProperty(TOAST_STACK_VARIABLE, cssValue)
  else root.style.removeProperty(TOAST_STACK_VARIABLE)
}

function useToastStore(): [MessageApi, ReactNode] {
  const [toasts, setToasts] = useState<Toast[]>([])
  const holderId = useId()
  const layerRef = useRef<HTMLDivElement>(null)
  const remove = useCallback((id: string) => setToasts(items => items.filter(item => item.id !== id)), [])
  const open = useCallback((config: MessageConfig) => {
    const id = config.key ?? crypto.randomUUID()
    // A repeated text message replaces its predecessor instead of stacking.
    const repeated = config.key ? undefined : repeatedContentKey(config.content)
    setToasts(items => trimToVisible([
      ...items.filter(item => item.id !== id && !(repeated !== undefined && item.repeated === repeated)),
      { ...config, id, repeated, type: config.type ?? 'info' },
    ]))
    if (config.duration !== 0) window.setTimeout(() => remove(id), (config.duration ?? 3) * 1000)
  }, [remove])
  const api = useMemo<MessageApi>(() => ({
    open,
    success: (content, duration) => open({ content, duration, type: 'success' }),
    error: (content, duration) => open({ content, duration, type: 'error' }),
    info: (content, duration) => open({ content, duration, type: 'info' }),
    warning: (content, duration) => open({ content, duration, type: 'warning' }),
    loading: (content, duration = 0) => open({ content, duration, type: 'loading' }),
    destroy: key => key ? remove(key) : setToasts([]),
  }), [open, remove])
  useEffect(() => {
    const layer = layerRef.current
    if (!layer || toasts.length === 0) {
      stackHeights.delete(holderId)
      publishStackHeight()
      return undefined
    }
    const measure = () => {
      stackHeights.set(holderId, layer.getBoundingClientRect().height)
      publishStackHeight()
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    observer?.observe(layer)
    return () => {
      observer?.disconnect()
      stackHeights.delete(holderId)
      publishStackHeight()
    }
  }, [holderId, toasts.length])
  const layer = <div className="ui-message-layer" ref={layerRef} aria-live="polite">{toasts.map(toast => <div className={`ui-message ui-message--${toast.type}`} key={toast.id}><span>{icons[toast.type]}</span><div>{toast.content}</div><button type="button" aria-label="关闭" onClick={() => remove(toast.id)}><X size={14}/></button></div>)}</div>
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
