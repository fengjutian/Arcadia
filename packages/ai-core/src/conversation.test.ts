import { describe, expect, it } from 'vitest'
import { compactChatHistory, parseStoredConversation, restoreConversation } from './conversation'

describe('AI conversation persistence', () => {
  it('rejects corrupt entries and caps restored history', () => {
    const raw = JSON.stringify([{ id:'1', role:'user', content:'hello' }, { bad:true }])
    expect(parseStoredConversation(raw)).toEqual([{ id:'1', role:'user', content:'hello' }])
    expect(parseStoredConversation('{bad')).toEqual([])
  })

  it('keeps the newest complete messages within the context budget', () => {
    const result = compactChatHistory([
      { role:'user', content:'old-old' },
      { role:'assistant', content:'middle' },
      { role:'user', content:'latest' },
    ], 11)
    expect(result).toEqual([{ role:'user', content:'latest' }])
  })

  it('truncates an oversized latest message from the front', () => {
    expect(compactChatHistory([{ role:'user', content:'123456789' }], 4)).toEqual([{ role:'user', content:'6789' }])
  })

  it('sanitizes stored citation ids without dropping valid turns', () => {
    const raw = JSON.stringify([{
      id:'a1',
      role:'assistant',
      content:'answer',
      docIds:[2, 'bad', 0, 3.5],
      documentIds:['doc-a', '', null],
    }])
    expect(parseStoredConversation(raw)).toEqual([{
      id:'a1',
      role:'assistant',
      content:'answer',
      docIds:[2],
      documentIds:['doc-a'],
    }])
  })

  it('restores pending and legacy reload errors as retryable interruptions', () => {
    const raw = JSON.stringify([
      { id:'u1', role:'user', content:'first' },
      { id:'a1', role:'assistant', content:'', pending:true },
      { id:'u2', role:'user', content:'second' },
      { id:'a2', role:'assistant', content:'生成因应用重新加载而中断，请重新提问。', error:'生成因应用重新加载而中断' },
    ])
    const restored = restoreConversation(raw)
    expect(restored[1]).toMatchObject({ id:'a1', pending:false, interrupted:true, content:'' })
    expect(restored[3]).toMatchObject({ id:'a2', pending:false, interrupted:true, content:'' })
    expect(restored[3].error).toBeUndefined()
  })

  it('leaves ordinary failures and completed answers untouched', () => {
    const raw = JSON.stringify([
      { id:'a1', role:'assistant', content:'answer', documentIds:['doc-a'] },
      { id:'a2', role:'assistant', content:'network down', error:'network down' },
    ])
    const restored = restoreConversation(raw)
    expect(restored[0]).toMatchObject({ content:'answer', documentIds:['doc-a'] })
    expect(restored[1]).toMatchObject({ content:'network down', error:'network down' })
    expect(restored[1].interrupted).toBeUndefined()
  })

  it('keeps a pending background task resumable after a page reload', () => {
    const raw = JSON.stringify([{
      id:'a-bg',
      role:'assistant',
      content:'',
      pending:true,
      backgroundTaskId:'assistant-123',
    }])
    expect(restoreConversation(raw)).toEqual([{
      id:'a-bg',
      role:'assistant',
      content:'',
      pending:true,
      backgroundTaskId:'assistant-123',
    }])
  })

  it('preserves a bounded research trail', () => {
    const raw = JSON.stringify([{
      id:'a-steps',
      role:'assistant',
      content:'answer',
      steps:[
        { index:1, kind:'mcp_tool', summary:'调用 MCP 工具 srv · search', detail:'{"hits":2}', at:'2026-11-02T00:00:00Z' },
        { index:2, kind:'answer', summary:'生成回答', at:'2026-11-02T00:00:01Z' },
      ],
    }])
    const parsed = parseStoredConversation(raw)
    expect(parsed[0].steps).toHaveLength(2)
    expect(parsed[0].steps?.[0]).toMatchObject({ kind:'mcp_tool', detail:'{"hits":2}' })
  })

  it('keeps small structured tool results and drops oversized ones', () => {
    const raw = JSON.stringify([{
      id:'a-results',
      role:'assistant',
      content:'answer',
      steps:[
        { index:1, kind:'mcp_tool', summary:'small', result:{ content:[{ type:'text', text:'ok' }] }, at:'' },
        { index:2, kind:'mcp_tool', summary:'big', result:{ content:[{ type:'text', text:'x'.repeat(30_000) }] }, at:'' },
      ],
    }])
    const parsed = parseStoredConversation(raw)
    expect(parsed[0].steps?.[0].result).toEqual({ content:[{ type:'text', text:'ok' }] })
    expect(parsed[0].steps?.[1].result).toBeUndefined()
  })
})
