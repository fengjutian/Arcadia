import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/main.scss'
import '@arcadia/ui/styles.scss'
import './styles/compact.scss'
import './styles/library.scss'
import './styles/search.scss'
import './styles/settings.scss'
import './styles/mcp.scss'
import './styles/skillhub.scss'
import './styles/glass.scss'
import { applyTypographySettings, readTypographySettings } from './features/settings/typography'
import { syncLocaleAcrossWindows } from '@arcadia/i18n'

applyTypographySettings(readTypographySettings())
syncLocaleAcrossWindows()

async function bootstrap() {
  const windowMode = new URLSearchParams(window.location.search).get('window')
  let content: ReactNode

  if (windowMode === 'little-arc') {
    document.body.classList.add('little-arc-window')
    const { LittleArcWindow } = await import('./features/littlearc/LittleArcWindow')
    content = <LittleArcWindow />
  } else if (windowMode === 'ai-assistant') {
    document.body.classList.add('floating-assistant-window')
    const { FloatingAssistantWindow } = await import('./features/ai/FloatingAssistantWindow')
    content = <FloatingAssistantWindow />
  } else {
    const [{ default: App }, { setAdBlockEnabledProvider }, { isAdBlockerEnabled }] = await Promise.all([
      import('./App'),
      import('@arcadia/browser-core'),
      import('./features/plugins/adBlocker'),
    ])
    // The browser package cannot import app settings; hand it the one host
    // decision it needs (whether ad blocking is on) before any tab is created.
    setAdBlockEnabledProvider(isAdBlockerEnabled)
    content = <App />
  }

  createRoot(document.getElementById('root')!).render(<StrictMode>{content}</StrictMode>)
}

void bootstrap()
