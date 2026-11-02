import { t } from '../../i18n'
import alpineSunrise from '../../assets/themes/alpine-sunrise.webp'
import auroraFlow from '../../assets/themes/aurora-flow.webp'
import mistyLake from '../../assets/themes/misty-lake.webp'

export type AppearancePreference = 'system' | 'light' | 'dark'
export type ThemeKind = 'color' | 'image'
export type ImageThemeId = 'alpine' | 'aurora' | 'forest' | 'bing'

export const APPEARANCE_CHANGE_EVENT = 'arcadia-appearance-change'
export const VISUAL_THEME_CHANGE_EVENT = 'arcadia-visual-theme-change'

const APPEARANCE_KEY = 'arcadia-appearance'
const THEME_KIND_KEY = 'arcadia-theme-kind'
const IMAGE_THEME_KEY = 'arcadia-image-theme'

export const IMAGE_THEMES: Array<{ id: ImageThemeId; label: string; description: string; url: string }> = [
  { id: 'alpine', label:t("\u96EA\u5C71\u6668\u5149"),description:t("\u660E\u4EAE\u6E29\u6696\u7684\u9AD8\u5C71\u65E5\u51FA"),url:alpineSunrise},
  { id: 'aurora', label:t("\u6781\u5149\u6D41\u5F71"),description:t("\u6DF1\u9083\u68A6\u5E7B\u7684\u84DD\u7D2B\u6D41\u5149"),url:auroraFlow},
  { id: 'forest', label:t("\u96FE\u6797\u6E56\u6CCA"),description:t("\u5B89\u9759\u81EA\u7136\u7684\u68EE\u6797\u6668\u96FE"),url:mistyLake},
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
  return value === 'aurora' || value === 'forest' || value === 'bing' ? value : 'alpine'
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