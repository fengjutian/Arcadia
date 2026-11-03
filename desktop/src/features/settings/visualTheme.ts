import { t } from '../../i18n'
import alpineSunrise from '../../assets/themes/alpine-sunrise.webp'
import auroraFlow from '../../assets/themes/aurora-flow.webp'
import mistyLake from '../../assets/themes/misty-lake.webp'

export type AppearancePreference = 'system' | 'light' | 'dark'
export type ThemeKind = 'color' | 'image'
export type ImageThemeId = 'alpine' | 'aurora' | 'forest' | 'bing'

export interface VisualThemeChangeDetail {
  kind: ThemeKind
  image: ImageThemeId
  background: boolean
}

export const APPEARANCE_CHANGE_EVENT = 'arcadia-appearance-change'
export const VISUAL_THEME_CHANGE_EVENT = 'arcadia-visual-theme-change'

const APPEARANCE_KEY = 'arcadia-appearance'
const THEME_KIND_KEY = 'arcadia-theme-kind'
const IMAGE_THEME_KEY = 'arcadia-image-theme'
const BACKGROUND_IMAGE_KEY = 'arcadia-background-image'

export const IMAGE_THEMES: Array<{ id: ImageThemeId; label: string; description: string; url: string }> = [
  { id: 'alpine', label:t("雪山晨光"),description:t("明亮温暖的高山日出"),url:alpineSunrise},
  { id: 'aurora', label:t("极光流影"),description:t("深邃梦幻的蓝紫流光"),url:auroraFlow},
  { id: 'forest', label:t("雾林湖泊"),description:t("安静自然的森林晨雾"),url:mistyLake},
]

export function readAppearancePreference(): AppearancePreference {
  const value = localStorage.getItem(APPEARANCE_KEY)
  return value === 'system' || value === 'light' || value === 'dark' ? value : 'system'
}

export function writeAppearancePreference(value: AppearancePreference) {
  localStorage.setItem(APPEARANCE_KEY, value)
  window.dispatchEvent(new CustomEvent<AppearancePreference>(APPEARANCE_CHANGE_EVENT, { detail: value }))
}

/**
 * The panel the appearance settings page had open last. This only remembers
 * which tab to show; it does not decide whether a wallpaper is painted.
 */
export function readThemeKind(): ThemeKind {
  return localStorage.getItem(THEME_KIND_KEY) === 'image' ? 'image' : 'color'
}

export function readImageTheme(): ImageThemeId {
  const value = localStorage.getItem(IMAGE_THEME_KEY)
  return value === 'aurora' || value === 'forest' || value === 'bing' ? value : 'alpine'
}

/**
 * Whether the chosen wallpaper is painted behind the titlebar and the new-tab
 * page. Wallpapers are independent of the colour theme: picking a colour theme
 * must not clear or hide an image the user has set.
 */
export function readBackgroundImageEnabled(): boolean {
  const stored = localStorage.getItem(BACKGROUND_IMAGE_KEY)
  if (stored === 'true' || stored === 'false') return stored === 'true'
  // Migration: before wallpapers became independent, the image theme was active
  // exactly when that theme kind had been chosen. Keep the same look on upgrade.
  return localStorage.getItem(THEME_KIND_KEY) === 'image'
}

export function writeBackgroundImageEnabled(value: boolean) {
  localStorage.setItem(BACKGROUND_IMAGE_KEY, String(value))
  notifyVisualTheme()
}

function notifyVisualTheme() {
  window.dispatchEvent(new CustomEvent<VisualThemeChangeDetail>(VISUAL_THEME_CHANGE_EVENT, {
    detail: { kind: readThemeKind(), image: readImageTheme(), background: readBackgroundImageEnabled() },
  }))
}

export function writeThemeKind(value: ThemeKind) {
  localStorage.setItem(THEME_KIND_KEY, value)
  notifyVisualTheme()
}

/** Selecting a wallpaper stores it, opens the image panel and turns it on. */
export function writeImageTheme(value: ImageThemeId) {
  localStorage.setItem(IMAGE_THEME_KEY, value)
  localStorage.setItem(THEME_KIND_KEY, 'image')
  localStorage.setItem(BACKGROUND_IMAGE_KEY, 'true')
  notifyVisualTheme()
}

/**
 * The frosted-glass material. It is decoration with a real cost: every blurred
 * pane is a compositing layer, which is why the switch exists. Off is not a
 * degraded experience — `glass.scss` keeps the same layout, edges and shadows on
 * solid surfaces — so the preference is safe to leave off on slow hardware.
 */
const GLASS_EFFECT_KEY = 'arcadia-glass-effect'
export const GLASS_EFFECT_CHANGE_EVENT = 'arcadia-glass-effect-change'

export function readGlassEffectEnabled(): boolean {
  try {
    return localStorage.getItem(GLASS_EFFECT_KEY) !== 'false'
  } catch {
    return true
  }
}

/** Applies the material to the document: `on` keeps the blur, `off` is solid. */
export function applyGlassEffect(enabled: boolean) {
  if (typeof document === 'undefined') return
  document.body.dataset.glass = enabled ? 'on' : 'off'
}

export function writeGlassEffectEnabled(value: boolean) {
  try {
    localStorage.setItem(GLASS_EFFECT_KEY, String(value))
  } catch {
    // A blocked storage backend still gets the visual change for this session.
  }
  applyGlassEffect(value)
  window.dispatchEvent(new CustomEvent<boolean>(GLASS_EFFECT_CHANGE_EVENT, { detail: value }))
}
