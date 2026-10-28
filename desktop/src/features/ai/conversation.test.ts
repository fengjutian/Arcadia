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
})
