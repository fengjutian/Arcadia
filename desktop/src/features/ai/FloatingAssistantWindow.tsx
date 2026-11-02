import { t } from '../../i18n'
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

  if (!payload) return <div className="floating-assistant-error">{t("\u65E0\u6CD5\u8BFB\u53D6 AI \u52A9\u624B\u4E0A\u4E0B\u6587\uFF0C\u8BF7\u5173\u95ED\u540E\u91CD\u8BD5\u3002")}</div>
  return <div className="floating-assistant-shell">
    <AssistantPanel
      {...payload}
      nativeWindow
      close={() => void closeFloatingAssistant(true)}
      saveToLibrary={async () => { await emitTo('main', FLOATING_ASSISTANT_SAVE_EVENT) }}
    />
  </div>
}