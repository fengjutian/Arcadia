import alpineSunrise from '../../assets/themes/alpine-sunrise.webp'
import auroraFlow from '../../assets/themes/aurora-flow.webp'
import mistyLake from '../../assets/themes/misty-lake.webp'

export type AppearancePreference = 'system' | 'light' | 'dark'
export type ThemeKind = 'color' | 'image'
export type ImageThemeId = 'alpine' | 'aurora' | 'forest'

export const APPEARANCE_CHANGE_EVENT = 'arcadia-appearance-change'
export const VISUAL_THEME_CHANGE_EVENT = 'arcadia-visual-theme-change'

const APPEARANCE_KEY = 'arcadia-appearance'
const THEME_KIND_KEY = 'arcadia-theme-kind'
const IMAGE_THEME_KEY = 'arcadia-image-theme'

export const IMAGE_THEMES: Array<{ id: ImageThemeId; label: string; description: string; url: string }> = [
  { id: 'alpine', label: '雪山晨光', description: '明亮温暖的高山日出', url: alpineSunrise },
  { id: 'aurora', label: '极光流影', description: '深邃梦幻的蓝紫流光', url: auroraFlow },
  { id: 'forest', label: '雾林湖泊', description: '安静自然的森林晨雾', url: mistyLake },
]

export function readAppearancePreference(): AppearancePreference {
  const value = localStorage.getItem(APPEARANCE_KEY)
  return value === 'system' || value === 'light' || value === 'dark' ? value : 'system'
}

export function writeAppearancePreference(value: AppearancePreference) {
  localStorage.setItem(APPEARANCE_KEY, value)
  window.dispatchEvent(new CustomEvent<AppearancePreference>(APPEARANCE_CHANGE_EVENT, { detail: value }))
}

export function readThemeKind(): ThemeKind {
  return localStorage.getItem(THEME_KIND_KEY) === 'image' ? 'image' : 'color'
}

export function readImageTheme(): ImageThemeId {
  const value = localStorage.getItem(IMAGE_THEME_KEY)
  return value === 'aurora' || value === 'forest' ? value : 'alpine'
}

function notifyVisualTheme() {
  window.dispatchEvent(new CustomEvent(VISUAL_THEME_CHANGE_EVENT, { detail: { kind: readThemeKind(), image: readImageTheme() } }))
}

export function writeThemeKind(value: ThemeKind) {
  localStorage.setItem(THEME_KIND_KEY, value)
  notifyVisualTheme()
}

export function writeImageTheme(value: ImageThemeId) {
  localStorage.setItem(IMAGE_THEME_KEY, value)
  localStorage.setItem(THEME_KIND_KEY, 'image')
  notifyVisualTheme()
}
