import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/main.scss'
import './styles/ui.scss'
import './styles/compact.scss'
import './styles/library.scss'
import './styles/search.scss'
import './styles/settings.scss'
import { applyTypographySettings, readTypographySettings } from './features/settings/typography'

applyTypographySettings(readTypographySettings())

createRoot(document.getElementById('root')!).render(<StrictMode><App/></StrictMode>)
