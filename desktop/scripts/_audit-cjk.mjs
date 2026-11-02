import fs from 'node:fs'
import path from 'node:path'
import * as parser from '@babel/parser'
import traverseModule from '@babel/traverse'
const traverse = traverseModule.default ?? traverseModule
const root = 'src'
const CJK = /[\u3400-\u9fff]/
const IDS = new Set(['t', 'translate', 'i18nTranslate'])
const allow = new Set(['features/ai/ask.ts', 'features/ai/crossAsk.ts', 'features/ai/conversation.ts', 'features/ai/agentLoop.ts', 'features/ai/summarize.ts', 'features/ai/bulkSummary.ts', 'features/ai/knowledgeAttachmentAdapter.ts', 'features/search/aiSearchPrompt.ts', 'features/search/aiSearchAnswer.ts', 'features/browser/browserUtils.ts', 'features/browser/searchEngine.ts', 'features/browser/mediaResources.ts', 'features/settings/typography.ts', 'features/history/visitStats.ts'])
function walk(dir) {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'i18n') out.push(...walk(f)) }
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(f)
  }
  return out
}
for (const file of walk(root)) {
  const rel = path.relative(root, file).split(path.sep).join('/')
  if (allow.has(rel)) continue
  const src = fs.readFileSync(file, 'utf8')
  if (!CJK.test(src)) continue
  const ast = parser.parse(src, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
  const left = []
  const isArg = p => {
    const parent = p.parentPath
    if (!parent?.isCallExpression()) return false
    const c = parent.node.callee
    return c.type === 'Identifier' && IDS.has(c.name) && parent.node.arguments[0] === p.node
  }
  traverse(ast, {
    StringLiteral(p) { if (CJK.test(p.node.value) && !isArg(p)) left.push(p.node.value) },
    TemplateLiteral(p) {
      const v = p.node.quasis.map(q => q.value.cooked ?? '').join('')
      if (CJK.test(v) && !isArg(p) && !p.parentPath?.isTaggedTemplateExpression()) left.push(v)
    },
    JSXText(p) { if (CJK.test(p.node.value) && p.node.value.trim()) left.push(p.node.value.trim()) },
  })
  if (left.length) {
    console.log('===== ' + rel)
    for (const v of [...new Set(left)].slice(0, 20)) console.log('   ' + JSON.stringify(v))
  }
}
