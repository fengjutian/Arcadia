import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as parser from '@babel/parser'
import traverseModule from '@babel/traverse'
import { afterEach, describe, expect, it } from 'vitest'
import { formatDateTime, getLocale, readLocale, resolveLocale, setLocale, t } from './index'
import { DEFAULT_LOCALE, LOCALE_LABELS, SUPPORTED_LOCALES } from './types'
import { EN_US_FRAGMENTS, enUS } from './en-US'

const traverse = (traverseModule as unknown as { default?: typeof traverseModule }).default ?? traverseModule
const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const CJK = /[\u3400-\u9fff]/
const IDENTIFIERS = new Set(['t', 'translate', 'i18nTranslate'])

/**
 * Files whose Chinese text is *data*, not UI chrome: model prompts, sentinel
 * strings compared against model output, bundled host/font names, and category
 * keys that are stored in SQLite. These are intentionally not translated.
 */
const CHINESE_DATA_FILES = new Set([
  'features/ai/ask.ts',
  'features/ai/crossAsk.ts',
  'features/ai/conversation.ts',
  'features/ai/agentLoop.ts',
  'features/ai/summarize.ts',
  'features/ai/bulkSummary.ts',
  'features/ai/knowledgeAttachmentAdapter.ts',
  'features/search/aiSearchPrompt.ts',
  'features/search/aiSearchAnswer.ts',
  'features/browser/browserUtils.ts',
  'features/browser/searchEngine.ts',
  'features/browser/mediaResources.ts',
  'features/settings/typography.ts',
  'features/history/visitStats.ts',
  'features/archive/archiveSettings.ts',
  'features/browser/sleepSettings.ts',
  'features/browser/spaces.ts',
  'features/clips/clips.ts',
  'features/command/siteSearch.ts',
])

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'i18n' || entry.name === 'node_modules') continue
      out.push(...walk(full))
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

function isTranslationArgument(nodePath: {
  parentPath: { isCallExpression: () => boolean; node: { callee: { type: string; name?: string }; arguments: unknown[] } } | null
  node: unknown
}): boolean {
  const parent = nodePath.parentPath
  if (!parent?.isCallExpression()) return false
  const callee = parent.node.callee
  return callee.type === 'Identifier' && IDENTIFIERS.has(callee.name ?? '') && parent.node.arguments[0] === nodePath.node
}

interface ScanResult {
  messageIds: Set<string>
  leftoverChinese: Map<string, string[]>
}

function scanSources(): ScanResult {
  const messageIds = new Set<string>()
  const leftoverChinese = new Map<string, string[]>()

  for (const file of walk(SRC_ROOT)) {
    const relative = path.relative(SRC_ROOT, file).split(path.sep).join('/')
    const source = fs.readFileSync(file, 'utf8')
    if (!CJK.test(source)) continue
    const ast = parser.parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
    const leftovers: string[] = []
    traverse(ast, {
      CallExpression(nodePath) {
        const callee = nodePath.node.callee
        if (callee.type !== 'Identifier' || !IDENTIFIERS.has(callee.name)) return
        const first = nodePath.node.arguments[0]
        if (!first) return
        if (first.type === 'StringLiteral') messageIds.add(first.value)
        else if (first.type === 'TemplateLiteral' && first.expressions.length === 0) messageIds.add(first.quasis[0]?.value.cooked ?? '')
      },
      StringLiteral(nodePath) {
        if (!CJK.test(nodePath.node.value)) return
        if (isTranslationArgument(nodePath as never)) return
        leftovers.push(nodePath.node.value)
      },
      TemplateLiteral(nodePath) {
        const value = nodePath.node.quasis.map(q => q.value.cooked ?? '').join('{…}')
        if (!CJK.test(value)) return
        if (isTranslationArgument(nodePath as never)) return
        if (nodePath.parentPath?.isTaggedTemplateExpression()) return
        leftovers.push(value)
      },
      JSXText(nodePath) {
        if (CJK.test(nodePath.node.value) && nodePath.node.value.trim()) leftovers.push(nodePath.node.value.trim())
      },
    })
    if (leftovers.length) leftoverChinese.set(relative, leftovers)
  }
  return { messageIds, leftoverChinese }
}

const scan = scanSources()

afterEach(() => {
  setLocale('zh-CN')
})

describe('i18n runtime', () => {
  it('defaults to Chinese and resolves locale aliases', () => {
    expect(DEFAULT_LOCALE).toBe('zh-CN')
    expect(resolveLocale('en')).toBe('en-US')
    expect(resolveLocale('en-GB')).toBe('en-US')
    expect(resolveLocale('zh-TW')).toBe('zh-CN')
    expect(resolveLocale(null)).toBe('zh-CN')
    setLocale('zh-CN')
    expect(getLocale()).toBe('zh-CN')
    expect(t('保存')).toBe('保存')
  })

  it('returns English translations and interpolates placeholders', () => {
    setLocale('en-US')
    expect(t('保存')).toBe('Save')
    expect(t('请填写{value0}', { value0: 'Email' })).toBe('Enter Email')
    expect(t('未知消息')).toBe('未知消息')
  })

  it('persists the locale and updates the document language', () => {
    setLocale('en-US')
    expect(readLocale()).toBe('en-US')
    expect(document.documentElement.lang).toBe('en-US')
    setLocale('zh-CN')
    expect(document.documentElement.lang).toBe('zh-CN')
  })

  it('exposes both first-batch languages with native labels', () => {
    expect(SUPPORTED_LOCALES).toEqual(['zh-CN', 'en-US'])
    expect(LOCALE_LABELS['zh-CN']).toBe('简体中文')
    expect(LOCALE_LABELS['en-US']).toBe('English')
  })

  it('formats dates with the active locale', () => {
    setLocale('en-US')
    expect(formatDateTime(new Date(2026, 0, 2, 15, 4))).toContain('2026')
    setLocale('zh-CN')
    expect(formatDateTime(new Date(2026, 0, 2, 15, 4))).toContain('2026')
  })
})

describe('English catalog', () => {
  it('translates every message id used by the UI', () => {
    const missing = [...scan.messageIds].filter(id => {
      const value = enUS[id]
      return value === undefined || (typeof value === 'string' && value.trim() === '')
    })
    expect(missing.sort()).toEqual([])
  })

  it('keeps placeholders intact', () => {
    const placeholder = /\{(\w+)\}/g
    const mismatches: string[] = []
    for (const [key, value] of Object.entries(enUS)) {
      const expected = [...key.matchAll(placeholder)].map(match => match[1]).sort()
      const actual = (typeof value === 'string' ? [value] : [value.one, value.other])
        .flatMap(text => [...text.matchAll(placeholder)].map(match => match[1]))
      const uniqueActual = [...new Set(actual)].sort()
      if (expected.join(',') !== uniqueActual.join(',')) mismatches.push(key)
    }
    expect(mismatches).toEqual([])
  })

  it('contains no Chinese characters', () => {
    const withChinese = Object.entries(enUS).filter(([, value]) => {
      const texts = typeof value === 'string' ? [value] : [value.one, value.other]
      return texts.some(text => CJK.test(text))
    })
    expect(withChinese).toEqual([])
  })

  it('has no duplicate ids with conflicting translations', () => {
    const seen = new Map<string, unknown>()
    const conflicts: string[] = []
    for (const [fragment, messages] of EN_US_FRAGMENTS) {
      for (const [key, value] of Object.entries(messages)) {
        if (seen.has(key) && JSON.stringify(seen.get(key)) !== JSON.stringify(value)) conflicts.push(`${fragment}: ${key}`)
        seen.set(key, value)
      }
    }
    expect(conflicts).toEqual([])
  })

  it('does not keep stale ids that no longer exist in the source', () => {
    const stale = Object.keys(enUS).filter(key => !scan.messageIds.has(key))
    expect(stale).toEqual([])
  })
})

describe('source localization', () => {
  it('has no untranslated Chinese outside designated data files', () => {
    const offenders = [...scan.leftoverChinese.entries()]
      .filter(([file]) => !CHINESE_DATA_FILES.has(file))
      .map(([file, values]) => `${file}: ${values.slice(0, 3).join(' | ')}`)
    expect(offenders).toEqual([])
  })
})
