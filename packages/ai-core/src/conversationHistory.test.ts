import { describe, expect, it } from 'vitest'
import { filterConversations, makeConversationTitle, normalizeConversationTitle } from './conversationHistory'

const conversations = [
  {
    id: 'research',
    title: '浏览器研究',
    updatedAt: '2026-10-30T00:00:00.000Z',
    turns: [{ role: 'user' as const, content: '比较 Chromium 和 WebView2' }],
  },
  {
    id: 'notes',
    title: '读书笔记',
    updatedAt: '2026-10-29T00:00:00.000Z',
    turns: [{ role: 'assistant' as const, content: '这里讨论知识管理方法' }],
  },
]

describe('conversation history helpers', () => {
  it('builds a compact title from the first user question', () => {
    expect(makeConversationTitle([{ role: 'assistant', content: '忽略' }, { role: 'user', content: '  第一行\n 第二行  ' }]))
      .toBe('第一行 第二行')
  })

  it('normalizes and limits a manually edited title', () => {
    expect(normalizeConversationTitle('  新的   标题  ')).toBe('新的 标题')
    expect(normalizeConversationTitle('a'.repeat(80))).toHaveLength(60)
  })

  it('searches both titles and message content with all terms required', () => {
    expect(filterConversations(conversations, '浏览器 WebView2').map(item => item.id)).toEqual(['research'])
    expect(filterConversations(conversations, '知识 管理').map(item => item.id)).toEqual(['notes'])
    expect(filterConversations(conversations, '不存在')).toEqual([])
  })
})
