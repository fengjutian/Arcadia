/**
 * Shared i18n types.
 *
 * Messages use gettext-style ids: the id *is* the Simplified Chinese source
 * string. Chinese is therefore the canonical locale and needs no catalog;
 * English translations live in `en-US/` and are looked up by that source text.
 * Missing English entries fall back to the Chinese source, so a string that has
 * not been migrated yet can never render as an empty label.
 */
export const SUPPORTED_LOCALES = ['zh-CN', 'en-US'] as const

export type Locale = (typeof SUPPORTED_LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'zh-CN'

/** Values substituted into `{name}` placeholders. */
export type MessageVars = Record<string, string | number | undefined>

/** A message that needs different English wording for one vs. many. */
export interface PluralMessage {
  one: string
  other: string
}

export type MessageValue = string | PluralMessage

/** All English messages, keyed by their Chinese source text. */
export type Messages = Record<string, MessageValue>

/** Native language names shown in the language picker; never translated. */
export const LOCALE_LABELS: Record<Locale, string> = {
  'zh-CN': '简体中文',
  'en-US': 'English',
}
