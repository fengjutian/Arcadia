/** Normalises the MCP `tools/call` result into renderable blocks. */

export interface TextBlock {
  type: 'text'
  text: string
}

export interface ImageBlock {
  type: 'image'
  mimeType: string
  data: string
}

export interface AudioBlock {
  type: 'audio'
  mimeType: string
  data: string
}

export interface ResourceBlock {
  type: 'resource'
  uri?: string
  mimeType?: string
  text?: string
}

export interface UnknownBlock {
  type: 'unknown'
  value: unknown
}

export type ToolResultBlock = TextBlock | ImageBlock | AudioBlock | ResourceBlock | UnknownBlock

export interface ParsedToolResult {
  blocks: ToolResultBlock[]
  structured?: unknown
  isError: boolean
  hasContent: boolean
}

const IMAGE_MIME = /^image\/(png|jpeg|webp|gif|avif|bmp)$/i
const AUDIO_MIME = /^audio\/(mpeg|mp3|wav|ogg|mp4|webm)$/i

export function isSafeImageMime(mimeType: unknown): mimeType is string {
  return typeof mimeType === 'string' && IMAGE_MIME.test(mimeType)
}

export function isSafeAudioMime(mimeType: unknown): mimeType is string {
  return typeof mimeType === 'string' && AUDIO_MIME.test(mimeType)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function parseBlock(value: unknown): ToolResultBlock {
  const block = asRecord(value)
  if (!block) return { type: 'unknown', value }
  if (block.type === 'text' && typeof block.text === 'string') {
    return { type: 'text', text: block.text }
  }
  if (block.type === 'image' && typeof block.data === 'string' && isSafeImageMime(block.mimeType)) {
    return { type: 'image', mimeType: block.mimeType, data: block.data }
  }
  if (block.type === 'audio' && typeof block.data === 'string' && isSafeAudioMime(block.mimeType)) {
    return { type: 'audio', mimeType: block.mimeType, data: block.data }
  }
  if (block.type === 'resource') {
    const resource = asRecord(block.resource)
    if (resource) {
      return {
        type: 'resource',
        uri: typeof resource.uri === 'string' ? resource.uri : undefined,
        mimeType: typeof resource.mimeType === 'string' ? resource.mimeType : undefined,
        text: typeof resource.text === 'string' ? resource.text : undefined,
      }
    }
  }
  return { type: 'unknown', value }
}

export function parseToolResult(value: unknown): ParsedToolResult {
  const record = asRecord(value)
  if (!record) {
    return {
      blocks: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? String(value) }],
      isError: false,
      hasContent: false,
    }
  }
  const content = Array.isArray(record.content) ? record.content : []
  const blocks = content.map(parseBlock)
  const structured = record.structuredContent
  const isError = record.isError === true
  if (blocks.length > 0) return { blocks, structured, isError, hasContent: true }
  if (typeof record.text === 'string') {
    return { blocks: [{ type: 'text', text: record.text }], structured, isError, hasContent: true }
  }
  return {
    blocks: [{ type: 'text', text: JSON.stringify(value, null, 2) ?? String(value) }],
    structured,
    isError,
    hasContent: false,
  }
}
