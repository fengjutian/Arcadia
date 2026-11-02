import type { Locale, MessageValue, Messages } from '../types'

/**
 * English catalog, merged from one fragment per UI domain. Fragment modules
 * exist so several areas can add translations without editing one giant map
 * (and without merge conflicts). `t()` falls back to the Chinese id when a key
 * is missing, so migrating a screen and translating it are independent steps.
 *
 * Conventions:
 * - The key is the exact Simplified Chinese source string, including
 *   punctuation and `{placeholder}` tokens.
 * - Use `{ one, other }` for messages whose English depends on a count.
 * - Keep placeholders from the key in the translation.
 */
import { common } from './common'
import { shell } from './shell'
import { browser } from './browser'
import { library } from './library'
import { search } from './search'
import { assistant } from './assistant'
import { settings } from './settings'
import { privacy } from './privacy'
import { mcp } from './mcp'
import { skillhub } from './skillhub'

const fragments: Messages[] = [common, shell, browser, library, search, assistant, settings, privacy, mcp, skillhub]

export const enUS: Messages = Object.assign({}, ...fragments)

/** Exposed for the catalog integrity test. */
export const EN_US_FRAGMENTS: ReadonlyArray<readonly [string, Messages]> = [
  ['common', common],
  ['shell', shell],
  ['browser', browser],
  ['library', library],
  ['search', search],
  ['assistant', assistant],
  ['settings', settings],
  ['privacy', privacy],
  ['mcp', mcp],
  ['skillhub', skillhub],
]

export type { MessageValue }
