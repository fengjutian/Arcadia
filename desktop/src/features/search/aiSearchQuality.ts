import { parseAnswerSegments } from './aiSearchAnswer'
import type { AiSearchSource } from './aiSearchPrompt'

export interface AiSearchQualityReport {
  score: number
  level: 'high' | 'medium' | 'low'
  factualParagraphs: number
  citedParagraphs: number
  citationCoverage: number
  invalidCitationIds: string[]
  citedSourceIds: string[]
  sourceDomains: number
  validVisuals: number
  invalidDslBlocks: number
  warnings: string[]
}

export function evaluateAiSearchAnswer(answer: string, sources: readonly AiSearchSource[]): AiSearchQualityReport {
  const validIds = new Set(sources.map(source => source.id))
  const citationIds = Array.from(answer.matchAll(/\[(S\d+)]/g), match => match[1])
  const citedSourceIds = Array.from(new Set(citationIds.filter(id => validIds.has(id))))
  const invalidCitationIds = Array.from(new Set(citationIds.filter(id => !validIds.has(id))))
  const factual = factualParagraphs(answer)
  const citedParagraphs = factual.filter(paragraph => Array.from(paragraph.matchAll(/\[(S\d+)]/g), match => match[1]).some(id => validIds.has(id))).length
  const citationCoverage = factual.length > 0 ? citedParagraphs / factual.length : 1
  const parsed = parseAnswerSegments(answer)
  const validVisuals = parsed.filter(segment => segment.kind !== 'markdown').length
  const declaredDslBlocks = Array.from(answer.matchAll(/```(ask|flow|timeline|chart)\b/gi)).length
  const invalidDslBlocks = Math.max(0, declaredDslBlocks - validVisuals)
  const sourceDomains = new Set(sources.map(source => domainOf(source.url)).filter(Boolean)).size
  const warnings: string[] = []
  if (citationCoverage < 0.7) warnings.push('部分事实段落缺少来源引用')
  if (invalidCitationIds.length > 0) warnings.push(`包含不存在的引用：${invalidCitationIds.join('、')}`)
  if (sources.length > 2 && sourceDomains < 2) warnings.push('证据集中在单一网站，建议增加来源多样性')
  if (invalidDslBlocks > 0) warnings.push('存在格式无效的交互或可视化组件')
  if (citedSourceIds.length === 0 && factual.length > 0) warnings.push('回答没有引用任何检索来源')

  const score = clamp(Math.round(
    100
    - (1 - citationCoverage) * 45
    - invalidCitationIds.length * 18
    - invalidDslBlocks * 10
    - (sources.length > 2 && sourceDomains < 2 ? 8 : 0)
    - (factual.length > 0 && citedSourceIds.length === 0 ? 22 : 0),
  ), 0, 100)
  return {
    score,
    level:score >= 80 ? 'high' : score >= 55 ? 'medium' : 'low',
    factualParagraphs:factual.length,
    citedParagraphs,
    citationCoverage,
    invalidCitationIds,
    citedSourceIds,
    sourceDomains,
    validVisuals,
    invalidDslBlocks,
    warnings,
  }
}

function factualParagraphs(markdown: string): string[] {
  const withoutDsl = markdown.replace(/```(?:ask|flow|timeline|chart)\b[\s\S]*?```/gi, '')
  return withoutDsl.split(/\n\s*\n/).map(paragraph => paragraph.trim()).filter(paragraph => {
    if (paragraph.length < 20 || /^#{1,6}\s/.test(paragraph)) return false
    if (/^(?:[-*+] |\d+[.)]\s)/.test(paragraph) && paragraph.split('\n').every(line => /^(?:[-*+] |\d+[.)]\s)/.test(line))) return false
    return true
  })
}

function domainOf(value: string): string {
  try { return new URL(value).hostname.replace(/^www\./, '') }
  catch { return '' }
}

function clamp(value: number, minimum: number, maximum: number): number { return Math.min(maximum, Math.max(minimum, value)) }
