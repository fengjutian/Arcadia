import { describe, expect, it } from 'vitest'
import { aiSearchCacheKey, readAiSearchCache, upsertAiSearchCache, type AiSearchCacheEntry } from './aiSearchCache'

const source = { id:'S1', documentId:'d1', title:'文档', url:'https://a.test', excerpt:'证据内容' }

describe('AI search cache', () => {
  it('uses provider, normalized question, history and evidence fingerprints', () => {
    const base = { providerId:'p1', question:'  SQLite   索引 ', history:[], sources:[source] }
    expect(aiSearchCacheKey(base)).toBe(aiSearchCacheKey({ ...base, question:'sqlite 索引' }))
    expect(aiSearchCacheKey(base)).not.toBe(aiSearchCacheKey({ ...base, providerId:'p2' }))
    expect(aiSearchCacheKey(base)).not.toBe(aiSearchCacheKey({ ...base, sources:[{ ...source, excerpt:'证据已变化' }] }))
    expect(aiSearchCacheKey(base)).not.toBe(aiSearchCacheKey({ ...base, history:[{ role:'user', content:'前文' }] }))
  })

  it('drops expired and malformed entries', () => {
    const valid: AiSearchCacheEntry = { key:'a', answer:'答案', sources:[source], citedIds:['S1'], createdAt:900 }
    const raw = JSON.stringify([valid, { broken:true }, { ...valid, key:'old', createdAt:1 }])
    expect(readAiSearchCache(raw, { now:1000, ttlMs:200 })).toEqual([valid])
    expect(readAiSearchCache('bad json')).toEqual([])
  })

  it('replaces duplicate keys and enforces the entry cap', () => {
    const entry = (key: string, createdAt: number): AiSearchCacheEntry => ({ key, answer:key, sources:[source], citedIds:[], createdAt })
    expect(upsertAiSearchCache([entry('a', 1), entry('b', 2)], entry('a', 3), 2).map(item => item.key)).toEqual(['a', 'b'])
  })
})
