import { describe, expect, it } from 'vitest'
import { evaluateAiSearchAnswer } from './aiSearchQuality'

const sources = [
  { id:'S1', documentId:'d1', title:'甲', url:'https://a.test/one', excerpt:'甲' },
  { id:'S2', documentId:'d2', title:'乙', url:'https://b.test/two', excerpt:'乙' },
]

describe('AI search answer quality', () => {
  it('reports strong coverage for cited factual paragraphs', () => {
    const report = evaluateAiSearchAnswer('第一段包含足够长的事实说明，并且明确引用来源。[S1]\n\n第二段同样给出具体结论，并使用另一个来源。[S2]', sources)
    expect(report.level).toBe('high')
    expect(report.citationCoverage).toBe(1)
    expect(report.sourceDomains).toBe(2)
    expect(report.invalidCitationIds).toEqual([])
  })

  it('penalizes uncovered claims, fabricated citations and malformed DSL', () => {
    const report = evaluateAiSearchAnswer('这是一段没有任何来源支持但长度足够的事实性结论。\n\n另一段声称有来源但编号并不存在。[S9]\n\n```chart\n只有一个 | 1\n```', sources)
    expect(report.level).toBe('low')
    expect(report.invalidCitationIds).toEqual(['S9'])
    expect(report.invalidDslBlocks).toBe(1)
    expect(report.warnings.length).toBeGreaterThan(1)
  })

  it('does not treat next-step bullet suggestions as factual paragraphs', () => {
    const report = evaluateAiSearchAnswer('## 下一步\n\n- 继续比较方案\n- 查看实施步骤', sources)
    expect(report.factualParagraphs).toBe(0)
    expect(report.citationCoverage).toBe(1)
  })
})
