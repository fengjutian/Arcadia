import { describe, expect, it } from 'vitest'
import rawCases from './fixtures/ai-search-eval-cases.json'
import { runAiSearchEvaluation, validateAiSearchEvalCases } from './aiSearchEval'

describe('AI search evaluation corpus', () => {
  it('has a valid, unique and extensible JSON schema', () => {
    const cases = validateAiSearchEvalCases(rawCases)
    expect(cases.length).toBeGreaterThanOrEqual(5)
    expect(new Set(cases.map(item => item.id)).size).toBe(cases.length)
  })

  it('meets the current deterministic acceptance bar', () => {
    const result = runAiSearchEvaluation(validateAiSearchEvalCases(rawCases))
    expect(result.results.filter(item => !item.passed)).toEqual([])
    expect(result.passRate).toBe(1)
    expect(result.averageScore).toBeGreaterThanOrEqual(75)
  })

  it('rejects duplicate ids instead of silently skewing metrics', () => {
    const duplicate = [rawCases[0], rawCases[0]]
    expect(() => validateAiSearchEvalCases(duplicate)).toThrow(/duplicate id/)
  })
})
