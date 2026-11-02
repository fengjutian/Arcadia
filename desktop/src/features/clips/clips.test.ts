import { describe, expect, it } from 'vitest'
import { clipFromImage, clipFromLink, clipFromSelection, clipPreview, clipSourceHost } from './clips'

const context = { url: 'https://example.com/article', title: 'Example article', now: 1_700_000_000_000 }

describe('clip builders', () => {
  it('builds a selection clip with provenance', () => {
    const clip = clipFromSelection('  cosine similarity  ', context)
    expect(clip).toMatchObject({
      kind: 'selection',
      content: 'cosine similarity',
      sourceUrl: 'https://example.com/article',
      sourceTitle: 'Example article',
      title: 'Example article',
      createdAt: 1_700_000_000_000,
    })
    expect(clip?.id).toBeTruthy()
  })

  it('builds link and image clips', () => {
    expect(clipFromLink('https://example.com/a', context)?.kind).toBe('link')
    expect(clipFromImage('https://example.com/a.png', context)?.kind).toBe('image')
  })

  it('rejects empty content and missing source', () => {
    expect(clipFromSelection('   ', context)).toBeNull()
    expect(clipFromSelection('text', { ...context, url: '' })).toBeNull()
  })
})

describe('clipPreview', () => {
  it('collapses whitespace and truncates', () => {
    expect(clipPreview({ content: 'a\n b   c' } as never)).toBe('a b c')
    expect(clipPreview({ content: 'x'.repeat(300) } as never, 10)).toHaveLength(10)
    expect(clipPreview({ content: 'x'.repeat(300) } as never, 10).endsWith('…')).toBe(true)
  })
})

describe('clipSourceHost', () => {
  it('strips www and falls back to the raw value', () => {
    expect(clipSourceHost({ sourceUrl: 'https://www.example.com/a' } as never)).toBe('example.com')
    expect(clipSourceHost({ sourceUrl: 'not a url' } as never)).toBe('not a url')
  })
})
