import { describe, expect, it } from 'vitest'
import { evaluateRetrieval, hasUsableAnswerCitations, reciprocalRankFusion, stripModelReasoning, stripSourceBlocks, validateAnswerCitations } from './rag'

const hit = (documentId: string, chunkIndex: number, excerpt = documentId) => ({ documentId, chunkIndex, excerpt })

describe('reciprocalRankFusion', () => {
  it('promotes chunks found by both keyword and vector retrieval', () => {
    const result = reciprocalRankFusion(
      [hit('keyword-only', 0), hit('shared', 0)],
      [hit('shared', 0), hit('vector-only', 0)],
      { limit: 3 },
    )
    expect(result[0].documentId).toBe('shared')
    expect(result[0].keywordRank).toBe(2)
    expect(result[0].vectorRank).toBe(1)
  })

  it('deduplicates identical chunks and caps chunks from one document', () => {
    const result = reciprocalRankFusion(
      [hit('a', 0), hit('a', 1), hit('a', 2), hit('b', 0)],
      [hit('a', 0), hit('a', 1)],
      { limit: 8, maxChunksPerDocument: 2 },
    )
    expect(result.filter(item => item.documentId === 'a')).toHaveLength(2)
    expect(result.filter(item => item.documentId === 'a' && item.chunkIndex === 0)).toHaveLength(1)
    expect(result.some(item => item.documentId === 'b')).toBe(true)
  })
})

describe('stripSourceBlocks', () => {
  it('removes complete and unterminated evidence blocks', () => {
    const answer = [
      'SQLite 支持事务。',
      '[SOURCE id="doc:local-1:chunk:0"]',
      'SQLite supports transactions.',
      '[/SOURCE]',
      '',
      'FTS5 用于全文检索。 [source:2] [doc-1]',
      '[SOURCE id="doc:local-2:chunk:1"]',
      'unterminated',
    ].join('\n')
    expect(stripSourceBlocks(answer)).toBe('SQLite 支持事务。\n\nFTS5 用于全文检索。')
  })

  it('leaves plain answers unchanged', () => {
    expect(stripSourceBlocks('第一行\n\n第二行')).toBe('第一行\n\n第二行')
  })
})

describe('stripModelReasoning', () => {
  it('removes closed provider reasoning blocks and keeps the final answer', () => {
    expect(stripModelReasoning('<think>internal reasoning</think>\n\n南京是历史文化名城。')).toBe('南京是历史文化名城。')
  })

  it('does not expose an unterminated reasoning block', () => {
    expect(stripModelReasoning('<think>unfinished internal reasoning')).toBe('')
  })
})

describe('validateAnswerCitations', () => {
  it('accepts statements grounded in known citations', () => {
    const result = validateAnswerCitations('SQLite 支持事务。[doc-1]\nFTS5 用于全文检索。[doc-2]', [1, 2])
    expect(result.valid).toBe(true)
    expect(result.citedIds).toEqual([1, 2])
  })

  it('reports unknown citations and uncited factual statements', () => {
    const result = validateAnswerCitations('第一句没有引用。第二句有错误引用。[doc-9]', [1, 2])
    expect(result.valid).toBe(false)
    expect(result.unknownIds).toEqual([9])
    expect(result.uncitedStatements).toEqual(['第一句没有引用。'])
  })

  it('allows the explicit not-found response without citations', () => {
    expect(validateAnswerCitations('知识库中未找到相关信息。', []).valid).toBe(true)
  })

  it('accepts paragraph-level citations after strict repair but rejects missing or unknown ids', () => {
    expect(hasUsableAnswerCitations(validateAnswerCitations('南京是江苏省省会。它是历史文化名城。[doc-1]', [1]))).toBe(true)
    expect(hasUsableAnswerCitations(validateAnswerCitations('南京是江苏省省会。', [1]))).toBe(false)
    expect(hasUsableAnswerCitations(validateAnswerCitations('南京是江苏省省会。[doc-9]', [1]))).toBe(false)
  })
})

describe('evaluateRetrieval', () => {
  it('computes macro recall at K and mean reciprocal rank', () => {
    const metrics = evaluateRetrieval([
      { relevantDocumentIds: ['a', 'b'], retrievedDocumentIds: ['x', 'a', 'b'] },
      { relevantDocumentIds: ['c'], retrievedDocumentIds: ['c', 'z'] },
    ], 2)
    expect(metrics.recallAtK).toBeCloseTo(0.75)
    expect(metrics.meanReciprocalRank).toBeCloseTo(0.75)
    expect(metrics.evaluatedCases).toBe(2)
  })

  it('returns stable zero metrics for an empty evaluation set', () => {
    expect(evaluateRetrieval([], 5)).toEqual({ recallAtK: 0, meanReciprocalRank: 0, evaluatedCases: 0 })
  })
})
