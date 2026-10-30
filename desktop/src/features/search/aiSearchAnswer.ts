import type { AiSearchSource } from './aiSearchPrompt'

export function extractFollowUpQuestions(markdown: string): string[] {
  const section = markdown.match(/(?:^|\n)#{1,4}\s*(?:下一步|继续追问|你还可以问)[^\n]*\n([\s\S]*?)(?=\n#{1,4}\s|$)/i)?.[1] ?? ''
  return Array.from(section.matchAll(/^\s*(?:[-*+] |\d+[.)]\s+)(.+)$/gm), match => cleanQuestion(match[1]))
    .filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index)
    .slice(0, 3)
}

export function answerAsMarkdown(question: string, answer: string, sources: readonly AiSearchSource[]): string {
  return [
    `# ${question}`,
    '',
    answer.trim(),
    '',
    '## 来源',
    '',
    ...sources.map(source => `- [${source.id}] [${source.title}](${source.url})`),
    '',
  ].join('\n')
}

export function standaloneAnswerHtml(input: {
  question: string
  answerHtml: string
  sources: readonly AiSearchSource[]
  createdAt?: Date
}): string {
  const sourceHtml = input.sources.map(source => `<li><span>${escapeHtml(source.id)}</span><a href="${escapeAttribute(safeUrl(source.url))}">${escapeHtml(source.title)}</a><small>${escapeHtml(domainOf(source.url))}</small></li>`).join('')
  const createdAt = (input.createdAt ?? new Date()).toLocaleString('zh-CN')
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">
<title>${escapeHtml(input.question)}</title><style>
:root{color-scheme:light dark;font:16px/1.7 system-ui,-apple-system,"Segoe UI",sans-serif}body{margin:0;background:#f5f2eb;color:#253029}main{max-width:900px;margin:40px auto;padding:0 22px}article{padding:28px 34px;border:1px solid #d9d5ca;border-radius:18px;background:#fff;box-shadow:0 12px 38px #352b1d12}header small{color:#777}h1{font-size:28px;line-height:1.25;margin:.2em 0 1em}h2{margin-top:1.6em}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d9d5ca;padding:8px 10px;text-align:left}blockquote{border-left:3px solid #43825f;margin-left:0;padding-left:16px;color:#59645e}.sources{margin-top:28px;padding-top:18px;border-top:1px solid #ddd}.sources ul{list-style:none;padding:0;display:grid;gap:8px}.sources li{display:grid;grid-template-columns:auto 1fr auto;gap:9px;align-items:center}.sources li>span{padding:1px 7px;border-radius:999px;background:#e2f1e8;color:#236641;font-size:12px}.sources small{color:#777}a{color:#286b49}@media(prefers-color-scheme:dark){body{background:#111713;color:#e7eee9}article{background:#19211c;border-color:#344139}th,td,.sources{border-color:#344139}a{color:#8bd0a8}}
</style></head><body><main><article><header><small>Arcadia AI Search · ${escapeHtml(createdAt)}</small><h1>${escapeHtml(input.question)}</h1></header><section>${input.answerHtml}</section><section class="sources"><h2>来源</h2><ul>${sourceHtml}</ul></section></article></main></body></html>`
}

function cleanQuestion(value: string): string {
  return value.replace(/^\s*[*_`]+|[*_`]+\s*$/g, '').replace(/^['“”]|['“”]$/g, '').trim().slice(0, 160)
}

function safeUrl(value: string): string {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '#'
  } catch { return '#' }
}

function domainOf(value: string): string {
  try { return new URL(value).hostname.replace(/^www\./, '') }
  catch { return value }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char] ?? char)
}

function escapeAttribute(value: string): string { return escapeHtml(value) }
