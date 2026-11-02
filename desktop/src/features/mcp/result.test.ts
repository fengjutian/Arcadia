import { describe, expect, it } from 'vitest'
import { parseToolResult } from './result'

describe('parseToolResult', () => {
  it('renders text content blocks', () => {
    const parsed = parseToolResult({ content: [{ type: 'text', text: 'hello' }] })
    expect(parsed.isError).toBe(false)
    expect(parsed.hasContent).toBe(true)
    expect(parsed.blocks).toEqual([{ type: 'text', text: 'hello' }])
  })

  it('keeps safe images and audio but rejects unsafe MIME types', () => {
    const parsed = parseToolResult({
      content: [
        { type: 'image', mimeType: 'image/png', data: 'AAAA' },
        { type: 'image', mimeType: 'image/svg+xml', data: 'AAAA' },
        { type: 'audio', mimeType: 'audio/mpeg', data: 'BBBB' },
      ],
    })
    expect(parsed.blocks[0]).toEqual({ type: 'image', mimeType: 'image/png', data: 'AAAA' })
    expect(parsed.blocks[1].type).toBe('unknown')
    expect(parsed.blocks[2]).toEqual({ type: 'audio', mimeType: 'audio/mpeg', data: 'BBBB' })
  })

  it('extracts resources and structured content', () => {
    const parsed = parseToolResult({
      content: [{ type: 'resource', resource: { uri: 'file:///a.txt', mimeType: 'text/plain', text: 'body' } }],
      structuredContent: { ok: true },
    })
    expect(parsed.blocks[0]).toEqual({
      type: 'resource',
      uri: 'file:///a.txt',
      mimeType: 'text/plain',
      text: 'body',
    })
    expect(parsed.structured).toEqual({ ok: true })
  })

  it('flags tool errors and falls back to raw text', () => {
    const parsed = parseToolResult({ isError: true, content: [] })
    expect(parsed.isError).toBe(true)
    expect(parsed.blocks[0].type).toBe('text')
    expect(parseToolResult('plain').blocks).toEqual([{ type: 'text', text: 'plain' }])
  })

  it('unwraps a plain text result object', () => {
    const parsed = parseToolResult({ text: 'direct' })
    expect(parsed.blocks).toEqual([{ type: 'text', text: 'direct' }])
  })
})
