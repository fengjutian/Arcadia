export type MediaResourceKind = 'video' | 'audio' | 'hls' | 'dash' | 'subtitle' | 'document'

export interface RawResourceCandidate {
  url: string
  initiatorType?: string
  transferSize?: number
  decodedBodySize?: number
  source?: 'performance' | 'dom'
}

export interface MediaResourceCandidate extends RawResourceCandidate {
  kind: MediaResourceKind
  fileName: string
  size: number | null
}

const EXTENSION_KIND: Record<string, MediaResourceKind> = {
  mp4: 'video', webm: 'video', mov: 'video', m4v: 'video', ogv: 'video',
  mp3: 'audio', m4a: 'audio', aac: 'audio', ogg: 'audio', oga: 'audio', wav: 'audio', flac: 'audio',
  m3u8: 'hls', mpd: 'dash', vtt: 'subtitle', srt: 'subtitle', ttml: 'subtitle',
  pdf: 'document', epub: 'document',
}

function parsedUrl(value: string): URL | null {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch { return null }
}

export function classifyMediaResource(value: string, initiatorType = ''): MediaResourceKind | null {
  const url = parsedUrl(value)
  if (!url) return null
  const name = url.pathname.split('/').pop() ?? ''
  const extension = name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
  if (EXTENSION_KIND[extension]) return EXTENSION_KIND[extension]
  if (/\.m3u8(?:$|[?#])/i.test(value)) return 'hls'
  if (/\.mpd(?:$|[?#])/i.test(value)) return 'dash'
  if (initiatorType === 'video') return 'video'
  if (initiatorType === 'audio') return 'audio'
  return null
}

export function normalizeMediaResources(raw: RawResourceCandidate[]): MediaResourceCandidate[] {
  const seen = new Set<string>()
  const result: MediaResourceCandidate[] = []
  for (const item of raw) {
    const kind = classifyMediaResource(item.url, item.initiatorType)
    if (!kind || seen.has(item.url)) continue
    const url = parsedUrl(item.url)
    if (!url) continue
    seen.add(item.url)
    const tail = decodeURIComponent(url.pathname.split('/').pop() || '')
    result.push({
      ...item,
      kind,
      fileName: tail || `${kind}-${result.length + 1}`,
      size: item.decodedBodySize || item.transferSize || null,
    })
    if (result.length >= 200) break
  }
  return result
}

export const mediaKindLabel: Record<MediaResourceKind, string> = {
  video: '视频', audio: '音频', hls: 'HLS', dash: 'DASH', subtitle: '字幕', document: '文档',
}
