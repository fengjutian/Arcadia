/**
 * i18n catalog maintenance.
 *
 * Scans `src/` for `t('...')` / `translate('...')` message ids and keeps the
 * English fragments under `src/i18n/en-US/` in sync:
 *
 *   node scripts/i18n-catalog.mjs           # report missing / stale / invalid keys
 *   node scripts/i18n-catalog.mjs --init    # add missing keys as empty strings
 *
 * Existing translations are never overwritten. Empty values make `t()` fall
 * back to the Chinese source, and the status check fails until they are filled,
 * so a half-migrated screen is impossible to ship by accident.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as parser from '@babel/parser'
import traverseModule from '@babel/traverse'

const traverse = traverseModule.default ?? traverseModule
const here = path.dirname(fileURLToPath(import.meta.url))
const srcRoot = path.resolve(here, '..', 'src')
const catalogRoot = path.join(srcRoot, 'i18n', 'en-US')

const FRAGMENTS = ['common', 'shell', 'browser', 'library', 'search', 'assistant', 'settings', 'privacy', 'mcp', 'skillhub']

function fragmentFor(file) {
  const rel = path.relative(srcRoot, file).split(path.sep).join('/')
  if (rel.startsWith('components/') || rel === 'api.ts' || rel.startsWith('services/') || rel.startsWith('shared/')) return 'common'
  if (rel.startsWith('layouts/') || rel.startsWith('app/') || rel.startsWith('features/command/') || rel.startsWith('features/browser/suggestion')) return 'shell'
  if (rel.startsWith('pages/browser/') || rel.startsWith('features/browser/') || rel.startsWith('features/downloads/') || rel.startsWith('features/history/') || rel.startsWith('features/bookmarks/') || rel.startsWith('features/tasks/') || rel.startsWith('features/archive/')) return 'browser'
  if (rel.startsWith('pages/library/') || rel.startsWith('features/documents/') || rel.startsWith('features/notes/') || rel.startsWith('features/reader/')) return 'library'
  if (rel.startsWith('pages/search/') || rel.startsWith('features/search/')) return 'search'
  if (rel.startsWith('pages/assistant/') || rel.startsWith('features/ai/')) return 'assistant'
  if (rel.startsWith('pages/settings/') || rel.startsWith('features/settings/')) return 'settings'
  if (rel.startsWith('features/privacy/')) return 'privacy'
  if (rel.startsWith('pages/mcp/') || rel.startsWith('features/mcp/')) return 'mcp'
  if (rel.startsWith('pages/skillhub/')) return 'skillhub'
  return 'common'
}

function walk(dir) {
  const out = []
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

const identifiers = new Set(['t', 'translate', 'i18nTranslate'])
const keysByFragment = new Map(FRAGMENTS.map(name => [name, new Set()]))
const seen = new Set()
const callSites = new Map()

for (const file of walk(srcRoot).sort()) {
  const source = fs.readFileSync(file, 'utf8')
  if (!source.includes('t(') && !source.includes('translate(')) continue
  let ast
  try {
    ast = parser.parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
  } catch (error) {
    console.error(`parse failed: ${file}: ${error.message}`)
    process.exitCode = 1
    continue
  }
  traverse(ast, {
    CallExpression(nodePath) {
      const callee = nodePath.node.callee
      if (callee.type !== 'Identifier' || !identifiers.has(callee.name)) return
      const first = nodePath.node.arguments[0]
      if (!first || (first.type !== 'StringLiteral' && first.type !== 'TemplateLiteral')) return
      const value = first.type === 'StringLiteral' ? first.value : first.quasis.map(q => q.value.cooked ?? q.value.raw).join('')
      callSites.set(value, (callSites.get(value) ?? 0) + 1)
      if (seen.has(value)) return
      seen.add(value)
      keysByFragment.get(fragmentFor(file)).add(value)
    },
  })
}

function escapeKey(key) {
  return `'${key.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`
}

function readExisting(name) {
  const file = path.join(catalogRoot, `${name}.ts`)
  if (!fs.existsSync(file)) return new Map()
  const source = fs.readFileSync(file, 'utf8')
  const values = new Map()
  const objectLiteral = source.slice(source.indexOf('{'), source.lastIndexOf('}') + 1)
  let ast
  try {
    ast = parser.parse(`const catalog = ${objectLiteral}`, { sourceType: 'module', plugins: ['typescript'] })
  } catch (error) {
    console.error(`catalog parse failed: ${file}: ${error.message}`)
    process.exitCode = 1
    return values
  }
  traverse(ast, {
    ObjectProperty(nodePath) {
      const key = nodePath.node.key
      const value = nodePath.node.value
      const name = key.type === 'StringLiteral' ? key.value : key.type === 'Identifier' ? key.name : null
      if (name == null) return
      if (value.type === 'StringLiteral') values.set(name, value.value)
      else if (value.type === 'TemplateLiteral' && value.expressions.length === 0) values.set(name, value.quasis[0].value.cooked ?? '')
      else if (value.type === 'ObjectExpression') {
        const one = value.properties.find(p => p.type === 'ObjectProperty' && p.key.type === 'Identifier' && p.key.name === 'one')
        const other = value.properties.find(p => p.type === 'ObjectProperty' && p.key.type === 'Identifier' && p.key.name === 'other')
        if (one?.value.type === 'StringLiteral' && other?.value.type === 'StringLiteral') values.set(name, { one: one.value.value, other: other.value.value })
      }
    },
  })
  return values
}

const init = process.argv.includes('--init')
let missing = 0
let empty = 0
let stale = 0

for (const fragment of FRAGMENTS) {
  const keys = [...keysByFragment.get(fragment)].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  const existing = readExisting(fragment)
  const lines = []
  let fragmentEmpty = 0
  for (const key of keys) {
    const value = existing.get(key)
    if (value === undefined) {
      missing += 1
      fragmentEmpty += 1
      if (init) lines.push(`  ${escapeKey(key)}: '',`)
    } else {
      if (typeof value === 'string' && value.trim() === '') {
        empty += 1
        fragmentEmpty += 1
      }
      if (typeof value === 'object') lines.push(`  ${escapeKey(key)}: { one: ${escapeKey(value.one)}, other: ${escapeKey(value.other)} },`)
      else lines.push(`  ${escapeKey(key)}: ${escapeKey(value)},`)
    }
  }
  for (const key of existing.keys()) if (!keys.includes(key)) stale += 1

  if (init) {
    const content = `import type { Messages } from '../types'\n\nexport const ${fragment}: Messages = {\n${lines.join('\n')}${lines.length ? '\n' : ''}}\n`
    fs.writeFileSync(path.join(catalogRoot, `${fragment}.ts`), content)
  }

  console.log(`${fragment.padEnd(9)} ${String(keys.length).padStart(4)} keys, ${String(fragmentEmpty).padStart(3)} untranslated`)
}

console.log(`\n${seen.size} message ids, ${callSites.size} unique, missing ${missing}, empty ${empty}, stale ${stale}`)
if (missing > 0 || empty > 0) {
  if (!init) {
    console.error('Run `node scripts/i18n-catalog.mjs --init` to add placeholders, then translate them.')
    process.exitCode = 1
  }
}
