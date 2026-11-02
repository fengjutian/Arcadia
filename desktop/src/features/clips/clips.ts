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

/** Whole-page clip: the readable Markdown, capped to stay under the DB limit. */
export function clipFromPage(markdown: string, context: ClipContext): Clip | null {
  return base('page', markdown.slice(0, 90_000), context)
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

function formatClipDate(timestamp: number): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/**
 * Markdown export keeps the provenance: a quote without its source is useless
 * a month later. Images/links are emitted as links, text as a blockquote.
 */
export function clipToMarkdown(clip: Clip): string {
  const title = clip.title?.trim() || clip.sourceTitle?.trim() || clipSourceHost(clip)
  const lines: string[] = [`## ${title}`, '']
  const meta: string[] = [`来源：${clip.sourceUrl}`]
  if (clip.kind !== 'page') meta.push(`类型：${CLIP_KIND_LABEL[clip.kind]}`)
  meta.push(`剪藏于：${formatClipDate(clip.createdAt)}`)
  lines.push(...meta.map(line => `> ${line}`), '')

  if (clip.kind === 'selection' || clip.kind === 'page') {
    lines.push(...clip.content.split('\n').map(line => `> ${line}`), '')
  } else {
    lines.push(`[${clip.kind === 'image' ? '图片' : '链接'}](${clip.content})`, '')
  }

  if (clip.note.trim()) {
    lines.push(`**备注**：${clip.note.trim()}`, '')
  }
  return lines.join('\n').trimEnd() + '\n'
}

/** Concatenate clips into one export document. */
export function clipsToMarkdown(clips: readonly Clip[]): string {
  return clips.map(clipToMarkdown).join('\n---\n\n')
}

