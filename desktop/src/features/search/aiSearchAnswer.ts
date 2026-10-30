import type { AiSearchSource } from './aiSearchPrompt'

export interface AiSearchAskBlock {
  kind: 'ask'
  question: string
  options: string[]
  suggested?: string
}

export interface AiSearchFlowBlock {
  kind: 'flow'
  edges: Array<{ from: string; to: string; label?: string }>
}

export interface AiSearchTimelineBlock {
  kind: 'timeline'
  items: Array<{ date: string; title: string; description?: string }>
}

export interface AiSearchChartBlock {
  kind: 'chart'
  title?: string
  items: Array<{ label: string; value: number }>
}

export type AiSearchAnswerSegment =
  | { kind: 'markdown'; content: string }
  | AiSearchAskBlock
  | AiSearchFlowBlock
  | AiSearchTimelineBlock
  | AiSearchChartBlock

export function parseAnswerSegments(markdown: string): AiSearchAnswerSegment[] {
  const segments: AiSearchAnswerSegment[] = []
  const pattern = /```(ask|flow|timeline|chart)\s*\n([\s\S]*?)```/gi
  let cursor = 0
  for (const match of markdown.matchAll(pattern)) {
    const index = match.index ?? 0
    pushMarkdown(segments, markdown.slice(cursor, index))
    const block = parseDslBlock(match[1].toLowerCase(), match[2])
    if (block) segments.push(block)
    else pushMarkdown(segments, match[0])
    cursor = index + match[0].length
  }
  pushMarkdown(segments, markdown.slice(cursor))
  return segments.length > 0 ? segments : [{ kind:'markdown', content:markdown }]
}

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
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-arcadia-answer'; img-src data:; base-uri 'none'; form-action 'none'; connect-src 'none'">
<title>${escapeHtml(input.question)}</title><style>
:root{color-scheme:light dark;font:16px/1.7 system-ui,-apple-system,"Segoe UI",sans-serif}body{margin:0;background:#f5f2eb;color:#253029}main{max-width:900px;margin:40px auto;padding:0 22px}article{padding:28px 34px;border:1px solid #d9d5ca;border-radius:18px;background:#fff;box-shadow:0 12px 38px #352b1d12}header small{color:#777}h1{font-size:28px;line-height:1.25;margin:.2em 0 1em}h2{margin-top:1.6em}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d9d5ca;padding:8px 10px;text-align:left}blockquote{border-left:3px solid #43825f;margin-left:0;padding-left:16px;color:#59645e}.sources{margin-top:28px;padding-top:18px;border-top:1px solid #ddd}.sources ul{list-style:none;padding:0;display:grid;gap:8px}.sources li{display:grid;grid-template-columns:auto 1fr auto;gap:9px;align-items:center}.sources li>span{padding:1px 7px;border-radius:999px;background:#e2f1e8;color:#236641;font-size:12px}.sources small{color:#777}a{color:#286b49}.ai-search-visual,.ai-search-ask{margin:20px 0;padding:16px;border:1px solid #ccd8d0;border-radius:14px;background:#f4f8f5}.ai-search-visual figcaption,.ai-search-ask__eyebrow{color:#286b49;font-size:11px;font-weight:800;letter-spacing:.08em}.ai-search-flow__edges{display:grid;gap:10px}.ai-search-flow__edge{display:grid;grid-template-columns:1fr .7fr 1fr;align-items:center;gap:8px}.ai-search-flow__node{padding:9px;border:1px solid #aec8b8;border-radius:9px;text-align:center;font-weight:650}.ai-search-flow__arrow{text-align:center;color:#397a56}.ai-search-flow__arrow i:after{content:' → '}.ai-search-flow__arrow em{display:block;font-size:10px}.ai-search-timeline ol{list-style:none;padding:0}.ai-search-timeline li{display:grid;grid-template-columns:90px 12px 1fr;gap:10px;margin:10px 0}.ai-search-timeline time{color:#286b49;font-weight:700}.ai-search-chart__rows{display:grid;gap:9px}.ai-search-chart__row{display:grid;grid-template-columns:130px 1fr 60px;gap:10px;align-items:center}.ai-search-chart__row>i{height:12px;background:#dce5df;border-radius:8px}.ai-search-chart__row>i>b{display:block;height:100%;background:#4e9b6d;border-radius:8px}.ai-search-ask__options{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px}.ai-search-ask__options button{padding:9px;border:1px solid #ccd8d0;border-radius:9px;background:#fff;color:inherit;text-align:left}.ai-search-ask__options button.is-selected{border-color:#39805a;background:#e4f2e9}.ai-search-ask input{box-sizing:border-box;width:100%;margin:10px 0;padding:9px;border:1px solid #ccd8d0;border-radius:8px}.ai-search-ask>button{padding:8px 12px;border:0;border-radius:8px;background:#347653;color:#fff}.ai-search-ask>button:disabled{opacity:.5}.ai-search-ask__status{margin-top:8px;color:#286b49;font-size:12px}@media(prefers-color-scheme:dark){body{background:#111713;color:#e7eee9}article{background:#19211c;border-color:#344139}th,td,.sources{border-color:#344139}a{color:#8bd0a8}.ai-search-visual,.ai-search-ask{background:#202b24;border-color:#405248}.ai-search-ask__options button{background:#19211c;border-color:#405248}}
</style></head><body><main><article><header><small>Arcadia AI Search · ${escapeHtml(createdAt)}</small><h1>${escapeHtml(input.question)}</h1></header><section>${input.answerHtml}</section><section class="sources"><h2>来源</h2><ul>${sourceHtml}</ul></section></article></main><script nonce="arcadia-answer">
document.addEventListener('click',function(event){var target=event.target instanceof Element?event.target:null;if(!target)return;var option=target.closest('[data-ai-ask-option]');if(option){var box=option.closest('[data-ai-ask-question]');if(!box)return;box.querySelectorAll('[data-ai-ask-option]').forEach(function(item){item.classList.remove('is-selected');item.setAttribute('aria-checked','false')});option.classList.add('is-selected');option.setAttribute('aria-checked','true');box.setAttribute('data-ai-ask-selected',option.getAttribute('data-ai-ask-option')||'');var submit=box.querySelector('[data-ai-ask-submit]');if(submit)submit.removeAttribute('disabled');return}var submit=target.closest('[data-ai-ask-submit]');if(!submit)return;var box=submit.closest('[data-ai-ask-question]');if(!box)return;var question=box.getAttribute('data-ai-ask-question')||'';var selected=box.getAttribute('data-ai-ask-selected')||'';var input=box.querySelector('[data-ai-ask-comment]');var comment=input instanceof HTMLInputElement?input.value:'';if(!question||!selected)return;if(window.parent!==window){window.parent.postMessage({type:'arcadia-ai-search-follow-up',question:question,option:selected,comment:comment},'*')}else{var status=box.querySelector('.ai-search-ask__status');if(!status){status=document.createElement('div');status.className='ai-search-ask__status';box.appendChild(status)}status.textContent='已选择：'+selected+(comment?'（'+comment+'）':'')}});
</script></body></html>`
}

function cleanQuestion(value: string): string {
  return value.replace(/^\s*[*_`]+|[*_`]+\s*$/g, '').replace(/^['“”]|['“”]$/g, '').trim().slice(0, 160)
}

function parseAskBlock(body: string): AiSearchAskBlock | null {
  const question = cleanQuestion(body.match(/^\s*question\s*:\s*(.+)$/im)?.[1] ?? '')
  const suggested = cleanQuestion(body.match(/^\s*suggested\s*:\s*(.+)$/im)?.[1] ?? '')
  const options = Array.from(body.matchAll(/^\s*[-*+]\s+(.+)$/gm), match => cleanQuestion(match[1]))
    .filter(value => value.length > 0)
    .filter((value, index, all) => all.indexOf(value) === index)
    .slice(0, 6)
  if (!question || options.length < 2) return null
  return { kind:'ask', question, options, suggested:options.includes(suggested) ? suggested : undefined }
}

function parseDslBlock(kind: string, body: string): AiSearchAnswerSegment | null {
  if (kind === 'ask') return parseAskBlock(body)
  if (kind === 'flow') return parseFlowBlock(body)
  if (kind === 'timeline') return parseTimelineBlock(body)
  if (kind === 'chart') return parseChartBlock(body)
  return null
}

function parseFlowBlock(body: string): AiSearchFlowBlock | null {
  const edges: AiSearchFlowBlock['edges'] = []
  for (const line of body.split(/\r?\n/)) {
    const match = line.trim().match(/^(.+?)\s*->\s*(.+?)(?:\s*:\s*(.+))?$/)
    if (!match) continue
    const from = cleanDslText(match[1], 60)
    const to = cleanDslText(match[2], 60)
    const label = cleanDslText(match[3] ?? '', 100)
    if (from && to) edges.push({ from, to, label:label || undefined })
    if (edges.length >= 12) break
  }
  return edges.length > 0 ? { kind:'flow', edges } : null
}

function parseTimelineBlock(body: string): AiSearchTimelineBlock | null {
  const items: AiSearchTimelineBlock['items'] = []
  for (const line of body.split(/\r?\n/)) {
    const [rawDate, rawTitle, ...rest] = line.split('|')
    const date = cleanDslText(rawDate ?? '', 40)
    const title = cleanDslText(rawTitle ?? '', 100)
    const description = cleanDslText(rest.join('|'), 240)
    if (date && title) items.push({ date, title, description:description || undefined })
    if (items.length >= 12) break
  }
  return items.length >= 2 ? { kind:'timeline', items } : null
}

function parseChartBlock(body: string): AiSearchChartBlock | null {
  let title: string | undefined
  const items: Array<{ label:string; value:number }> = []
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim()
    const titleMatch = line.match(/^title\s*:\s*(.+)$/i)
    if (titleMatch) { title = cleanDslText(titleMatch[1], 100) || undefined; continue }
    const separator = line.lastIndexOf('|')
    if (separator < 1) continue
    const label = cleanDslText(line.slice(0, separator), 80)
    const value = Number(line.slice(separator + 1).trim())
    if (label && Number.isFinite(value)) items.push({ label, value })
    if (items.length >= 10) break
  }
  return items.length >= 2 ? { kind:'chart', title, items } : null
}

function cleanDslText(value: string, max: number): string {
  return value.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function pushMarkdown(segments: AiSearchAnswerSegment[], content: string) {
  if (content.trim()) segments.push({ kind:'markdown', content:content.trim() })
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
