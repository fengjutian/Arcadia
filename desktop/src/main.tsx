import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/main.scss'
import './styles/ui.scss'
import './styles/compact.scss'
import './styles/library.scss'
import './styles/search.scss'
import './styles/settings.scss'
import './styles/mcp.scss'
import './styles/skillhub.scss'
import './styles/glass.scss'
import { applyTypographySettings, readTypographySettings } from './features/settings/typography'
import { FloatingAssistantWindow } from './features/ai/FloatingAssistantWindow'
import { isFloatingAssistantWindow } from './features/ai/floatingAssistant'
import { LittleArcWindow } from './features/littlearc/LittleArcWindow'
import { isLittleArcWindow } from './features/littlearc/littleArc'
import { syncLocaleAcrossWindows } from '@arcadia/i18n'

applyTypographySettings(readTypographySettings())
syncLocaleAcrossWindows()

const floatingAssistantWindow = isFloatingAssistantWindow()
if (floatingAssistantWindow) document.body.classList.add('floating-assistant-window')
const littleArcWindow = isLittleArcWindow()
if (littleArcWindow) document.body.classList.add('little-arc-window')

createRoot(document.getElementById('root')!).render(<StrictMode>{littleArcWindow ? <LittleArcWindow/> : floatingAssistantWindow ? <FloatingAssistantWindow/> : <App/>}</StrictMode>)
