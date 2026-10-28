export type TypographyFontId = 'source-han-serif' | 'source-han-sans' | 'lxgw-wenkai' | 'system'

export interface TypographySettings {
  /** Font family used by the application chrome and long-form reading views. */
  fontFamily: TypographyFontId
  /** Reading font size in CSS pixels. */
  fontSize: number
}

export interface TypographyFontOption {
  id: TypographyFontId
  label: string
  latin: string
  license: string
  stack: string
}

export const TYPOGRAPHY_STORAGE_KEY = 'arcadia-typography.v1'
export const TYPOGRAPHY_CHANGE_EVENT = 'arcadia-typography-change'
export const FONT_SIZE_MIN = 14
export const FONT_SIZE_MAX = 24

export const DEFAULT_TYPOGRAPHY_SETTINGS: TypographySettings = {
  fontFamily: 'source-han-serif',
  fontSize: 18,
}

/**
 * Open-source font families, in preference order. The app does not ship font
 * binaries; each stack resolves the installed family first and then falls back
 * to a same-style system face so CJK text never drops to a generic fallback.
 */
export const TYPOGRAPHY_FONTS: TypographyFontOption[] = [
  {
    id: 'source-han-serif',
    label: '思源宋体',
    latin: 'Source Han Serif / Noto Serif SC',
    license: 'SIL OFL 1.1',
    stack: "'Source Han Serif SC', 'Source Han Serif CN', 'Noto Serif SC', 'Noto Serif CJK SC', 'Songti SC', STSong, SimSun, serif",
  },
  {
    id: 'source-han-sans',
    label: '思源黑体',
    latin: 'Source Han Sans / Noto Sans SC',
    license: 'SIL OFL 1.1',
    stack: "'Source Han Sans SC', 'Source Han Sans CN', 'Noto Sans SC', 'Noto Sans CJK SC', 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', sans-serif",
  },
  {
    id: 'lxgw-wenkai',
    label: '霞鹜文楷',
    latin: 'LXGW WenKai',
    license: 'SIL OFL 1.1',
    stack: "'LXGW WenKai', 'LXGW WenKai Screen', 'LXGW WenKai Lite', 'Kaiti SC', KaiTi, STKaiti, serif",
  },
  {
    id: 'system',
    label: '系统默认',
    latin: 'System UI',
    license: '系统字体',
    stack: "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
  },
]

export function typographyFont(id: TypographyFontId): TypographyFontOption {
  return TYPOGRAPHY_FONTS.find(font => font.id === id) ?? TYPOGRAPHY_FONTS[0]
}

export function clampTypographyFontSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_TYPOGRAPHY_SETTINGS.fontSize
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(value)))
}

function normalizeSettings(value: Partial<TypographySettings> | null | undefined): TypographySettings {
  const requested = value?.fontFamily
  const fontFamily = TYPOGRAPHY_FONTS.some(font => font.id === requested)
    ? requested as TypographyFontId
    : DEFAULT_TYPOGRAPHY_SETTINGS.fontFamily
  return {
    fontFamily,
    fontSize: clampTypographyFontSize(value?.fontSize ?? DEFAULT_TYPOGRAPHY_SETTINGS.fontSize),
  }
}

export function readTypographySettings(): TypographySettings {
  try {
    const value = JSON.parse(localStorage.getItem(TYPOGRAPHY_STORAGE_KEY) ?? '{}') as Partial<TypographySettings>
    return normalizeSettings(value)
  } catch {
    return { ...DEFAULT_TYPOGRAPHY_SETTINGS }
  }
}

/** Publish the current choices as CSS custom properties used by the stylesheet. */
export function applyTypographySettings(settings: TypographySettings): void {
  const normalized = normalizeSettings(settings)
  const font = typographyFont(normalized.fontFamily)
  const root = document.documentElement
  root.style.setProperty('--font-ui', font.stack)
  root.style.setProperty('--font-reading', font.stack)
  root.style.setProperty('--reading-font-size', `${normalized.fontSize}px`)
  root.dataset.typographyFont = normalized.fontFamily
}

export function writeTypographySettings(settings: TypographySettings): TypographySettings {
  const normalized = normalizeSettings(settings)
  localStorage.setItem(TYPOGRAPHY_STORAGE_KEY, JSON.stringify(normalized))
  applyTypographySettings(normalized)
  window.dispatchEvent(new CustomEvent<TypographySettings>(TYPOGRAPHY_CHANGE_EVENT, { detail: normalized }))
  return normalized
}
