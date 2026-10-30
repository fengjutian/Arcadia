import { describe, expect, it } from 'vitest'
import { classifyMediaResource, normalizeMediaResources } from './mediaResources'

describe('media resource discovery', () => {
  it('classifies supported resource URLs without relying on query strings', () => {
    expect(classifyMediaResource('https://cdn.test/movie.mp4?token=secret')).toBe('video')
    expect(classifyMediaResource('https://cdn.test/master.m3u8')).toBe('hls')
    expect(classifyMediaResource('https://cdn.test/manifest.mpd')).toBe('dash')
    expect(classifyMediaResource('https://cdn.test/subtitles.vtt')).toBe('subtitle')
    expect(classifyMediaResource('javascript:alert(1)')).toBeNull()
  })

  it('deduplicates candidates and uses browser size metadata', () => {
    const resources = normalizeMediaResources([
      { url: 'https://cdn.test/a.mp3', decodedBodySize: 42, source: 'performance' },
      { url: 'https://cdn.test/a.mp3', transferSize: 12, source: 'dom' },
      { url: 'https://cdn.test/app.js', transferSize: 10 },
    ])
    expect(resources).toHaveLength(1)
    expect(resources[0]).toMatchObject({ kind: 'audio', fileName: 'a.mp3', size: 42 })
  })
})
