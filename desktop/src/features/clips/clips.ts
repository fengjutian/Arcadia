import type { Clip, ClipKind } from '../../api'

export const CLIP_KIND_LABEL: Record<ClipKind, string> = {
  selection: '选中文字',
  link: '链接',
  image: '图片',
  page: '页面',
}

interface ClipContext {
  url?: string
  title?: string
  now?: number
}

function base(kind: ClipKind, content: string, context: ClipContext): Clip | null {
  const text = content.trim()
  if (!text) return null
  const now = context.now ?? Date.now()
  const sourceUrl = context.url?.trim() ?? ''
  if (!sourceUrl) return null
  return {
    id: crypto.randomUUID(),
    kind,
    content: text,
    title: context.title?.trim() ?? '',
    sourceUrl,
    sourceTitle: context.title?.trim() ?? '',
    note: '',
    collectionId: null,
    createdAt: now,
    updatedAt: now,
  }
}

export function clipFromSelection(selection: string, context: ClipContext): Clip | null {
  return base('selection', selection, context)
}

export function clipFromLink(linkUrl: string, context: ClipContext): Clip | null {
  return base('link', linkUrl, context)
}

export function clipFromImage(imageUrl: string, context: ClipContext): Clip | null {
  return base('image', imageUrl, context)
}

/** One-line preview used by the library list. */
export function clipPreview(clip: Clip, maxLength = 180): string {
  const collapsed = clip.content.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= maxLength) return collapsed
  return `${collapsed.slice(0, maxLength - 1)}…`
}

export function clipSourceHost(clip: Clip): string {
  try {
    return new URL(clip.sourceUrl).hostname.replace(/^www\./, '')
  } catch {
    return clip.sourceUrl
  }
}
