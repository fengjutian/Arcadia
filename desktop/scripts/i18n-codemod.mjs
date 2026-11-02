/**
 * One-off codemod: wraps user-facing Simplified Chinese string literals,
 * JSX text nodes and template literals with `t()` from the i18n runtime.
 *
 * Usage (from `desktop/`):
 *   node scripts/i18n-codemod.mjs           # dry run, prints the files it would change
 *   node scripts/i18n-codemod.mjs --write   # rewrite sources
 *
 * The codemod deliberately skips:
 * - tests;
 * - AI prompt / model-output marker modules, whose Chinese is data rather than UI;
 * - modules whose Chinese strings are host names, font names, search-engine
 *   brands or structural category keys (translated where displayed instead).
 *
 * Files that already bind the identifier `t` import `translate` instead, so the
 * transform never shadows local variables.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as parser from '@babel/parser'
import traverseModule from '@babel/traverse'
import generateModule from '@babel/generator'
import * as t from '@babel/types'

const traverse = traverseModule.default ?? traverseModule
const generate = generateModule.default ?? generateModule

const here = path.dirname(fileURLToPath(import.meta.url))
const srcRoot = path.resolve(here, '..', 'src')
const write = process.argv.includes('--write')

const CJK = /[\u3400-\u9fff]/
const EXCLUDED = [
  /\.test\.(ts|tsx)$/,
  /(^|\/)i18n\//,
  /^features\/ai\/ask\.ts$/,
  /^features\/ai\/crossAsk\.ts$/,
  /^features\/ai\/conversation\.ts$/,
  /^features\/ai\/agentLoop\.ts$/,
  /^features\/ai\/summarize\.ts$/,
  /^features\/ai\/translate\.ts$/,
  /^features\/ai\/bulkSummary\.ts$/,
  /^features\/ai\/knowledgeAttachmentAdapter\.ts$/,
  /^features\/search\/aiSearchPrompt\.ts$/,
  /^features\/search\/aiSearchAnswer\.ts$/,
  /^features\/browser\/browserUtils\.ts$/,
  /^features\/browser\/searchEngine\.ts$/,
  /^features\/browser\/mediaResources\.ts$/,
  /^features\/settings\/typography\.ts$/,
  /^features\/history\/visitStats\.ts$/,
]

function walk(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

function importPathFor(file) {
  const rel = path.relative(path.dirname(file), path.join(srcRoot, 'i18n')).split(path.sep).join('/')
  return rel.startsWith('.') ? rel : `./${rel}`
}

function isTypePosition(path) {
  let node = path.node
  let parent = path.parentPath
  while (parent) {
    if (
      parent.isTSLiteralType() ||
      parent.isTSInterfaceDeclaration() ||
      parent.isTSTypeAliasDeclaration() ||
      parent.isTSTypeReference() ||
      parent.isTSAsExpression() ||
      parent.isTSTypeAssertion() ||
      parent.isTSNonNullExpression()
    ) {
      return true
    }
    if (parent.isStatement() || parent.isExpression()) return false
    node = parent.node
    parent = parent.parentPath
  }
  return false
}

function shouldSkipString(path) {
  const parent = path.parentPath
  if (!parent) return true
  if (parent.isImportDeclaration() || parent.isExportAllDeclaration()) return true
  if (parent.isExportNamedDeclaration() && parent.node.source) return true
  if (parent.isObjectProperty({ key: path.node }) || parent.isObjectMethod({ key: path.node })) {
    return !parent.node.computed
  }
  if (parent.isMemberExpression({ property: path.node })) return !parent.node.computed
  if (parent.isBinaryExpression() && /^[=!]==?$/.test(parent.node.operator)) return true
  if (parent.isSwitchCase({ test: path.node })) return true
  if (parent.isCallExpression({ callee: path.node })) return true
  if (parent.isCallExpression() && parent.node.callee.type === 'Identifier' && (parent.node.callee.name === 't' || parent.node.callee.name === 'translate') && parent.node.arguments[0] === path.node) return true
  if (parent.isTSLiteralType() || isTypePosition(path)) return true
  if (parent.isJSXAttribute() && parent.node.name && parent.node.name.name === 'key') return true
  return false
}

function buildCall(name, message, vars) {
  return t.callExpression(t.identifier(name), vars ? [t.stringLiteral(message), vars] : [t.stringLiteral(message)])
}

function extractTemplate(path) {
  const { quasis, expressions } = path.node
  if (!quasis.some(q => CJK.test(q.value.cooked ?? q.value.raw))) return null
  const vars = {}
  let message = ''
  for (let i = 0; i < quasis.length; i += 1) {
    message += quasis[i].value.cooked ?? quasis[i].value.raw
    if (i < expressions.length) {
      const key = `value${i}`
      vars[key] = t.identifier(key)
      message += `{${key}}`
    }
  }
  if (/[{}]/.test(message.replace(/\{value\d+\}/g, ''))) return null
  return { message, vars: expressions.map((expr, i) => [t.identifier(`value${i}`), expr]) }
}

function detectBindings(ast) {
  let tBound = false
  let translateBound = false
  traverse(ast, {
    Scope(path) {
      if (path.scope.hasOwnBinding('t')) tBound = true
      if (path.scope.hasOwnBinding('translate')) translateBound = true
    },
  })
  return { tBound, translateBound }
}

let changed = 0
const report = []

for (const file of walk(srcRoot)) {
  const relative = path.relative(srcRoot, file).split(path.sep).join('/')
  if (EXCLUDED.some(rule => rule.test(relative))) continue
  const source = fs.readFileSync(file, 'utf8')
  if (!CJK.test(source)) continue

  const ast = parser.parse(source, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx'],
    errorRecovery: false,
    tokens: true,
  })

  const bindings = detectBindings(ast)
  // Prefer `t`; if any scope in the module already binds it (for example a
  // local `const t = text.toLowerCase()`), fall back to `translate` so every
  // generated call resolves to the import.
  const name = bindings.tBound ? (bindings.translateBound ? 'i18nTranslate' : 'translate') : 't'
  let touched = false

  traverse(ast, {
    JSXText(path) {
      const raw = path.node.value
      if (!CJK.test(raw)) return
      const message = raw.trim()
      if (!message) return
      const replacement = t.jsxExpressionContainer(buildCall(name, message))
      const isPlainSpaceStart = /^ /.test(raw)
      const isPlainSpaceEnd = / $/.test(raw)
      path.replaceWith(replacement)
      if (isPlainSpaceEnd) path.insertAfter(t.jsxText(' '))
      if (isPlainSpaceStart) path.insertBefore(t.jsxText(' '))
      touched = true
    },
    TemplateLiteral(path) {
      if (path.parentPath.isTaggedTemplateExpression()) return
      if (path.parentPath.isCallExpression() && path.parentPath.node.callee.type === 'Identifier' && (path.parentPath.node.callee.name === 't' || path.parentPath.node.callee.name === 'translate')) return
      const extracted = extractTemplate(path)
      if (!extracted) return
      const vars = extracted.vars.length
        ? t.objectExpression(extracted.vars.map(([key, value]) => t.objectProperty(key, value)))
        : null
      path.replaceWith(buildCall(name, extracted.message, vars))
      touched = true
    },
    StringLiteral(path) {
      if (!CJK.test(path.node.value)) return
      if (shouldSkipString(path)) return
      const call = buildCall(name, path.node.value)
      if (path.parentPath.isJSXAttribute()) {
        path.parentPath.node.value = t.jsxExpressionContainer(call)
      } else {
        path.replaceWith(call)
      }
      touched = true
    },
  })

  if (!touched) continue
  changed += 1

  // Add the import once, after the last existing import. Done on the generated
  // text so the format-preserving generator never has to lay out a new node.
  const hasI18nImport = ast.program.body.some(node => {
    if (node.type !== 'ImportDeclaration') return false
    return node.source.value.endsWith('/i18n') || node.source.value === './i18n'
  })
  let output = generate(ast, {
    retainLines: true,
    experimental_preserveFormat: true,
    comments: true,
  }, source).code
  if (!hasI18nImport) {
    const specifier = name === 'i18nTranslate' ? 'translate as i18nTranslate' : name
    output = `import { ${specifier} } from '${importPathFor(file)}'\n${output}`
  }

  report.push({ relative, addedImport: !hasI18nImport, name })
  if (write) fs.writeFileSync(file, output)
}

console.log(`${write ? 'Rewrote' : 'Would rewrite'} ${changed} files`)
for (const entry of report) console.log(`  ${entry.name === 't' ? 't' : 'translate'}  ${entry.relative}`)
