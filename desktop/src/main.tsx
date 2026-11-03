import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
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
import { FloatingAssistantWindow } from './features/ai/FloatingAssistantWindow'
import { isFloatingAssistantWindow } from '@arcadia/ai-core/floatingAssistant'
import { LittleArcWindow } from './features/littlearc/LittleArcWindow'
import { isLittleArcWindow } from './features/littlearc/littleArc'
import { syncLocaleAcrossWindows } from '@arcadia/i18n'
import { setAdBlockEnabledProvider } from '@arcadia/browser-core'
import { isAdBlockerEnabled } from './features/plugins/adBlocker'

applyTypographySettings(readTypographySettings())
syncLocaleAcrossWindows()
// The browser package cannot import app settings; hand it the one host
// decision it needs (whether ad blocking is on) before any tab is created.
setAdBlockEnabledProvider(isAdBlockerEnabled)

const floatingAssistantWindow = isFloatingAssistantWindow()
if (floatingAssistantWindow) document.body.classList.add('floating-assistant-window')
const littleArcWindow = isLittleArcWindow()
if (littleArcWindow) document.body.classList.add('little-arc-window')

createRoot(document.getElementById('root')!).render(<StrictMode>{littleArcWindow ? <LittleArcWindow/> : floatingAssistantWindow ? <FloatingAssistantWindow/> : <App/>}</StrictMode>)
