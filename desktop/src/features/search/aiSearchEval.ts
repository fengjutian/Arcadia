import { evaluateAiSearchAnswer, type AiSearchQualityReport } from './aiSearchQuality'
import { prepareAiSearchSources, type AiSearchSource } from './aiSearchPrompt'

export interface AiSearchEvalCase {
  id: string
  question: string
  sources: Array<Omit<AiSearchSource, 'id'>>
  answer: string
  expect: {
    minScore?: number
    maxScore?: number
    maxInvalidCitations: number
    expectedInvalidCitation?: string
    sourceCount: number
    minDomains: number
    validVisuals: number
  }
}

export interface AiSearchEvalResult {
  id: string
  passed: boolean
  failures: string[]
  report: AiSearchQualityReport
  sourceCount: number
}

export function validateAiSearchEvalCases(value: unknown): AiSearchEvalCase[] {
  if (!Array.isArray(value)) throw new Error('AI search evaluation corpus must be an array')
  const ids = new Set<string>()
  return value.map((raw, index) => {
    if (!raw || typeof raw !== 'object') throw new Error(`Evaluation case ${index} must be an object`)
    const item = raw as Partial<AiSearchEvalCase>
    if (!item.id || typeof item.id !== 'string' || ids.has(item.id)) throw new Error(`Evaluation case ${index} has an invalid or duplicate id`)
    ids.add(item.id)
    if (typeof item.question !== 'string' || !item.question.trim()) throw new Error(`Evaluation case ${item.id} has no question`)
    if (typeof item.answer !== 'string' || !item.answer.trim()) throw new Error(`Evaluation case ${item.id} has no answer`)
    if (!Array.isArray(item.sources) || item.sources.length === 0) throw new Error(`Evaluation case ${item.id} has no sources`)
    if (!item.expect || typeof item.expect !== 'object') throw new Error(`Evaluation case ${item.id} has no expectations`)
    return item as AiSearchEvalCase
  })
}

export function runAiSearchEvalCase(item: AiSearchEvalCase): AiSearchEvalResult {
  const sources = prepareAiSearchSources(item.sources)
  const report = evaluateAiSearchAnswer(item.answer, sources)
  const failures: string[] = []
  if (item.expect.minScore !== undefined && report.score < item.expect.minScore) failures.push(`score ${report.score} < ${item.expect.minScore}`)
  if (item.expect.maxScore !== undefined && report.score > item.expect.maxScore) failures.push(`score ${report.score} > ${item.expect.maxScore}`)
  if (report.invalidCitationIds.length > item.expect.maxInvalidCitations && !item.expect.expectedInvalidCitation) failures.push(`invalid citations ${report.invalidCitationIds.length}`)
  if (item.expect.expectedInvalidCitation && !report.invalidCitationIds.includes(item.expect.expectedInvalidCitation)) failures.push(`missing invalid citation ${item.expect.expectedInvalidCitation}`)
  if (sources.length !== item.expect.sourceCount) failures.push(`sources ${sources.length} != ${item.expect.sourceCount}`)
  if (report.sourceDomains < item.expect.minDomains) failures.push(`domains ${report.sourceDomains} < ${item.expect.minDomains}`)
  if (report.validVisuals !== item.expect.validVisuals) failures.push(`visuals ${report.validVisuals} != ${item.expect.validVisuals}`)
  return { id:item.id, passed:failures.length === 0, failures, report, sourceCount:sources.length }
}

export function runAiSearchEvaluation(cases: readonly AiSearchEvalCase[]) {
  const results = cases.map(runAiSearchEvalCase)
  return {
    results,
    evaluatedCases:results.length,
    passedCases:results.filter(result => result.passed).length,
    passRate:results.length > 0 ? results.filter(result => result.passed).length / results.length : 0,
    averageScore:results.length > 0 ? results.reduce((sum, result) => sum + result.report.score, 0) / results.length : 0,
  }
}
