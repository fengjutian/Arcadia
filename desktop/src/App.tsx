import { useEffect, useState, type CSSProperties } from 'react'
import { UIProvider } from './components/ui'
import { AppRouter } from './app/AppRouter'
import { readThemePreference, THEME_CHANGE_EVENT, type ThemePreference } from './features/settings/theme'
import { APPEARANCE_CHANGE_EVENT, IMAGE_THEMES, readAppearancePreference, readImageTheme, readThemeKind, VISUAL_THEME_CHANGE_EVENT, type AppearancePreference, type ImageThemeId, type ThemeKind } from './features/settings/visualTheme'
import { loadBingDailyImage, readCachedBingDailyImage } from './features/settings/bingDailyTheme'
import { readAdvancedSettings } from './features/settings/advanced'
import { useTaskWorker } from './features/tasks/useTaskWorker'

const PALETTES = {
  green: { primary: '#347851', sider: '#edf2ee', item: '#68766e', hover: '#e3ebe5', hoverText: '#275f3f', selected: '#d9e8dd', selectedText: '#275f3f' },
  beige: { primary: '#8a6846', sider: '#f1eadf', item: '#75695d', hover: '#e9decf', hoverText: '#6f5034', selected: '#e1d2bd', selectedText: '#6f5034' },
  light: { primary: '#3f6f5a', sider: '#f3f4f3', item: '#68706c', hover: '#e8ebe9', hoverText: '#334b40', selected: '#dde5e0', selectedText: '#334b40' },
  dark: { primary: '#65a77d', sider: '#18211d', item: '#a9b7af', hover: '#24332b', hoverText: '#d6e7dc', selected: '#294438', selectedText: '#8fd1a8' },
  github: { primary: '#0969da', sider: '#f6f8fa', item: '#57606a', hover: '#eaeef2', hoverText: '#1f2328', selected: '#ddf4ff', selectedText: '#0969da' },
  ocean: { primary: '#2563a8', sider: '#edf4fb', item: '#5b6d7e', hover: '#e1edf8', hoverText: '#194f89', selected: '#d7e9f8', selectedText: '#194f89' },
  cyan: { primary: '#087f8c', sider: '#ecf7f8', item: '#587477', hover: '#ddf1f3', hoverText: '#05636d', selected: '#cfebee', selectedText: '#05636d' },
  mint: { primary: '#2f7d68', sider: '#edf7f3', item: '#5c746d', hover: '#dff0e9', hoverText: '#22604f', selected: '#d2eae1', selectedText: '#22604f' },
  amber: { primary: '#9a6a00', sider: '#fbf5e7', item: '#786d54', hover: '#f4ead1', hoverText: '#755000', selected: '#f0e1b9', selectedText: '#755000' },
  coral: { primary: '#b4512f', sider: '#fbf0eb', item: '#7c675f', hover: '#f5e3da', hoverText: '#8c3d22', selected: '#f1d7cb', selectedText: '#8c3d22' },
  rose: { primary: '#ad4968', sider: '#faeff3', item: '#7a626a', hover: '#f3dfe6', hoverText: '#87344f', selected: '#efd2dc', selectedText: '#87344f' },
  violet: { primary: '#7352ad', sider: '#f3effa', item: '#6f657c', hover: '#e9e1f5', hoverText: '#583b8d', selected: '#e0d5f0', selectedText: '#583b8d' },
} as const

export default function App() {
  const [preference, setPreference] = useState<ThemePreference>(readThemePreference)
  const [appearance, setAppearance] = useState<AppearancePreference>(readAppearancePreference)
  const [themeKind, setThemeKind] = useState<ThemeKind>(readThemeKind)
  const [imageTheme, setImageTheme] = useState<ImageThemeId>(readImageTheme)
  const [bingImage, setBingImage] = useState(readCachedBingDailyImage)
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)

  useTaskWorker()

  useEffect(() => {
    const handlePreference = (event: Event) => {
      const next = (event as CustomEvent<ThemePreference>).detail
      setPreference(next)
    }
    window.addEventListener(THEME_CHANGE_EVENT, handlePreference)
    return () => window.removeEventListener(THEME_CHANGE_EVENT, handlePreference)
  }, [])

  useEffect(() => {
    const handleAppearance = (event: Event) => setAppearance((event as CustomEvent<AppearancePreference>).detail)
    const handleVisualTheme = (event: Event) => {
      const next = (event as CustomEvent<{ kind: ThemeKind; image: ImageThemeId }>).detail
      setThemeKind(next.kind)
      setImageTheme(next.image)
    }
    window.addEventListener(APPEARANCE_CHANGE_EVENT, handleAppearance)
    window.addEventListener(VISUAL_THEME_CHANGE_EVENT, handleVisualTheme)
    return () => {
      window.removeEventListener(APPEARANCE_CHANGE_EVENT, handleAppearance)
      window.removeEventListener(VISUAL_THEME_CHANGE_EVENT, handleVisualTheme)
    }
  }, [])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const handleSystemTheme = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    setSystemDark(media.matches)
    media.addEventListener('change', handleSystemTheme)
    return () => media.removeEventListener('change', handleSystemTheme)
  }, [])

  const colorPreference = preference === 'dark' || preference === 'system' ? 'green' : preference
  const darkAppearance = appearance === 'dark' || (appearance === 'system' && systemDark)
  const resolvedPreference = darkAppearance ? 'dark' : colorPreference

  useEffect(() => {
    if (imageTheme !== 'bing') return
    void loadBingDailyImage().then(image => { if (image) setBingImage(image) })
  }, [imageTheme])

  useEffect(() => {
    document.body.dataset.theme = resolvedPreference
    document.body.dataset.themePreference = appearance
    document.body.dataset.themeKind = themeKind
    document.body.dataset.imageTheme = imageTheme
    const imageUrl = imageTheme === 'bing' && bingImage?.url
      ? bingImage.url
      : (IMAGE_THEMES.find(item => item.id === imageTheme) ?? IMAGE_THEMES[0]).url
    document.body.style.setProperty('--app-theme-image', `url("${imageUrl}")`)
    document.documentElement.style.colorScheme = resolvedPreference === 'dark' ? 'dark' : 'light'
  }, [appearance, bingImage, imageTheme, resolvedPreference, themeKind])

  useEffect(() => {
    document.body.dataset.reduceMotion = readAdvancedSettings().reduceMotion ? 'true' : 'false'
  }, [])

  const palette = PALETTES[resolvedPreference]
  return <UIProvider><div style={{ '--ui-primary': palette.primary, '--ui-sider': palette.sider, '--ui-item': palette.item, '--ui-hover': palette.hover, '--ui-hover-text': palette.hoverText, '--ui-selected': palette.selected, '--ui-selected-text': palette.selectedText } as CSSProperties}><AppRouter /></div></UIProvider>
}
