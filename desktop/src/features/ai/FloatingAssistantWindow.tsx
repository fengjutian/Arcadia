import { useEffect, useState } from 'react'
import { emitTo, listen } from '@tauri-apps/api/event'
import { AssistantPanel } from './AssistantPanel'
import {
  FLOATING_ASSISTANT_SAVE_EVENT,
  closeFloatingAssistant,
  readFloatingAssistantPayload,
  type FloatingAssistantPayload,
} from './floatingAssistant'

export function FloatingAssistantWindow() {
  const [payload, setPayload] = useState<FloatingAssistantPayload | null>(readFloatingAssistantPayload)

  useEffect(() => {
    let unlisten: (() => void) | undefined
    void listen<FloatingAssistantPayload>('assistant://payload-updated', event => setPayload(event.payload)).then(fn => { unlisten = fn })
    return () => unlisten?.()
  }, [])

  if (!payload) return <div className="floating-assistant-error">无法读取 AI 助手上下文，请关闭后重试。</div>
  return <div className="floating-assistant-shell">
    <AssistantPanel
      {...payload}
      nativeWindow
      close={() => void closeFloatingAssistant(true)}
      saveToLibrary={async () => { await emitTo('main', FLOATING_ASSISTANT_SAVE_EVENT) }}
    />
  </div>
}
