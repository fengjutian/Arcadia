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
import { applyTypographySettings, readTypographySettings } from './features/settings/typography'
import { FloatingAssistantWindow } from './features/ai/FloatingAssistantWindow'
import { isFloatingAssistantWindow } from './features/ai/floatingAssistant'

applyTypographySettings(readTypographySettings())

const floatingAssistantWindow = isFloatingAssistantWindow()
if (floatingAssistantWindow) document.body.classList.add('floating-assistant-window')

createRoot(document.getElementById('root')!).render(<StrictMode>{floatingAssistantWindow ? <FloatingAssistantWindow/> : <App/>}</StrictMode>)
