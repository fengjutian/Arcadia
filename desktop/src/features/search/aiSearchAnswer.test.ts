import { describe, expect, it } from 'vitest'
import { answerAsMarkdown, extractFollowUpQuestions, parseAnswerSegments, standaloneAnswerHtml } from './aiSearchAnswer'

const sources = [{ id:'S1', documentId:'d1', title:'来源一', url:'https://example.com/a?x=1&y=2', excerpt:'正文' }]

describe('AI search answer utilities', () => {
  it('extracts generated follow-up questions', () => {
    expect(extractFollowUpQuestions('## 结论\n内容\n\n## 下一步\n- 比较 A 与 B？\n- 给出步骤\n\n## 来源')).toEqual(['比较 A 与 B？', '给出步骤'])
  })

  it('parses a constrained ask block between markdown sections', () => {
    expect(parseAnswerSegments('结论\n\n```ask\nquestion: 你更重视什么？\nsuggested: 稳定性\n- 稳定性\n- 成本\n```\n\n后文')).toEqual([
      { kind:'markdown', content:'结论' },
      { kind:'ask', question:'你更重视什么？', options:['稳定性', '成本'], suggested:'稳定性' },
      { kind:'markdown', content:'后文' },
    ])
  })

  it('leaves malformed ask blocks as inert markdown', () => {
    const [segment] = parseAnswerSegments('```ask\nquestion: 只有一个选项\n- 一个\n```')
    expect(segment.kind).toBe('markdown')
  })

  it('parses flow, timeline and chart blocks with bounded data', () => {
    const segments = parseAnswerSegments([
      '```flow', '检索 -> 证据: 去重', '证据 -> 答案: 生成', '```',
      '```timeline', '2024 | 原型 | 验证需求', '2025 | 发布 | 正式上线', '```',
      '```chart', 'title: 命中率', '关键词 | 72', '混合检索 | 91.5', '```',
    ].join('\n'))
    expect(segments).toEqual([
      { kind:'flow', edges:[{ from:'检索', to:'证据', label:'去重' }, { from:'证据', to:'答案', label:'生成' }] },
      { kind:'timeline', items:[{ date:'2024', title:'原型', description:'验证需求' }, { date:'2025', title:'发布', description:'正式上线' }] },
      { kind:'chart', title:'命中率', items:[{ label:'关键词', value:72 }, { label:'混合检索', value:91.5 }] },
    ])
  })

  it('keeps incomplete visual blocks inert', () => {
    expect(parseAnswerSegments('```timeline\n2026 | 只有一项\n```')[0].kind).toBe('markdown')
    expect(parseAnswerSegments('```chart\n只有一个 | 1\n```')[0].kind).toBe('markdown')
  })

  it('builds portable markdown with sources', () => {
    expect(answerAsMarkdown('问题', '答案 [S1]', sources)).toContain('- [S1] [来源一](https://example.com/a?x=1&y=2)')
  })

  it('escapes metadata and rejects active source schemes in standalone HTML', () => {
    const html = standaloneAnswerHtml({ question:'<问题>', answerHtml:'<p>安全答案</p>', sources:[{ ...sources[0], url:'javascript:alert(1)' }], createdAt:new Date('2026-10-30T00:00:00Z') })
    expect(html).toContain('&lt;问题&gt;')
    expect(html).toContain('href="#"')
    expect(html).not.toContain('href="javascript:')
    expect(html).toContain('Content-Security-Policy')
    expect(html).toContain("script-src 'nonce-arcadia-answer'")
    expect(html).toContain('arcadia-ai-search-follow-up')
  })
})
