import { useSyncExternalStore } from 'react'
import { enUS } from './en-US'
import {
  DEFAULT_LOCALE,
  LOCALE_LABELS,
  SUPPORTED_LOCALES,
  type Locale,
  type MessageVars,
} from './types'

export { DEFAULT_LOCALE, LOCALE_LABELS, SUPPORTED_LOCALES }
export type { Locale, MessageVars, MessageValue, PluralMessage } from './types'

const STORAGE_KEY = 'arcadia-locale'
const CHANGE_EVENT = 'arcadia-locale-change'

function normalizeLocale(raw: string | null | undefined): Locale | null {
  if (!raw) return null
  const value = raw.trim().toLowerCase()
  if (SUPPORTED_LOCALES.includes(value as Locale)) return value as Locale
  if (value.startsWith('en')) return 'en-US'
  if (value.startsWith('zh')) return 'zh-CN'
  return null
}

function applyDocumentLocale(locale: Locale) {
  if (typeof document === 'undefined') return
  document.documentElement.lang = locale
  document.documentElement.dataset.locale = locale
}

/** Reads the persisted locale, falling back to the product default (Chinese). */
export function readLocale(): Locale {
  try {
    return normalizeLocale(localStorage.getItem(STORAGE_KEY)) ?? DEFAULT_LOCALE
  } catch {
    return DEFAULT_LOCALE
  }
}

let currentLocale: Locale = readLocale()

applyDocumentLocale(currentLocale)

export function getLocale(): Locale {
  return currentLocale
}

export function resolveLocale(raw: string | null | undefined): Locale {
  return normalizeLocale(raw) ?? DEFAULT_LOCALE
}

export interface SetLocaleOptions {
  /**
   * Reload the window after persisting. The recommended path for the settings
   * UI: it lets components and module-level constants (shortcut tables, theme
   * presets, engine lists, ...) rebuild in the new language without requiring
   * every module to subscribe to locale changes.
   */
  reload?: boolean
}

/**
 * Persists and activates a locale. In the app, call this with `reload: true`
 * (see `changeLocale`) so the whole tree re-renders in the new language.
 */
export function setLocale(locale: Locale, options: SetLocaleOptions = {}): void {
  currentLocale = normalizeLocale(locale) ?? DEFAULT_LOCALE
  try {
    localStorage.setItem(STORAGE_KEY, currentLocale)
  } catch {
    // A blocked storage backend should not make the language switch throw.
  }
  applyDocumentLocale(currentLocale)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<Locale>(CHANGE_EVENT, { detail: currentLocale }))
    if (options.reload) window.location.reload()
  }
}

/** Persist the choice and reload so the entire UI uses the new catalog. */
export function changeLocale(locale: Locale): void {
  setLocale(locale, { reload: true })
}

export function subscribeLocale(listener: (locale: Locale) => void): () => void {
  if (typeof window === 'undefined') return () => undefined
  const handler = (event: Event) => listener((event as CustomEvent<Locale>).detail)
  window.addEventListener(CHANGE_EVENT, handler)
  return () => window.removeEventListener(CHANGE_EVENT, handler)
}

/** React subscription used by the app root and the language picker. */
export function useLocale(): Locale {
  return useSyncExternalStore(
    listener => subscribeLocale(() => listener()),
    () => getLocale(),
    () => DEFAULT_LOCALE,
  )
}

function interpolate(template: string, vars?: MessageVars): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = vars[key]
    return value === undefined ? match : String(value)
  })
}

/**
 * Translates a gettext-style message id (the Chinese source string).
 *
 * `t('已保存 {count} 篇文档', { count })` renders the English catalog entry with
 * the same placeholders; untranslated ids return the interpolated Chinese
 * source. Catalog entries may be `{ one, other }`, selected with `vars.count`.
 */
export function translate(message: string, vars?: MessageVars): string {
  if (currentLocale === 'en-US') {
    const entry = enUS[message]
    if (typeof entry === 'string') return interpolate(entry, vars)
    if (entry) {
      const count = Number(vars?.count ?? 0)
      return interpolate(count === 1 ? entry.one : entry.other, vars)
    }
  }
  return interpolate(message, vars)
}

/** Shorthand for `translate`. */
export const t = translate

/** Locale-aware date/time formatting; the argument may be ms, Date, or ISO. */
export function formatDateTime(
  value: number | string | Date,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' },
): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return typeof value === 'string' ? value : ''
  return new Intl.DateTimeFormat(currentLocale, options).format(date)
}

/** Locale-aware number formatting. */
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(currentLocale, options).format(value)
}

/**
 * Keeps auxiliary windows (for example the floating assistant) in sync when the
 * main window switches language: `storage` only fires in other windows, so this
 * listener reloads them rather than leaving a stale catalog behind.
 */
export function syncLocaleAcrossWindows(): void {
  if (typeof window === 'undefined') return
  window.addEventListener('storage', event => {
    if (event.key !== STORAGE_KEY) return
    if (resolveLocale(event.newValue) !== currentLocale) window.location.reload()
  })
}
