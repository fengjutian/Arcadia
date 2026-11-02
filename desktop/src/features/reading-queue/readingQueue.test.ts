import { describe, expect, it } from 'vitest'
import type { BrowserTab } from '../../types'
import { formatQueuedAt, queueHost, readingQueueEntryFromTab } from './readingQueue'

function tab(patch: Partial<BrowserTab> = {}): BrowserTab {
  return {
    id: 't1',
    url: 'https://example.com/article',
    title: 'Example article',
    favicon: 'https://example.com/favicon.ico',
    loading: false,
    active: true,
    pinned: false,
    ...patch,
  }
}

describe('readingQueueEntryFromTab', () => {
  it('copies the tab identity and stamps the queue time', () => {
    const entry = readingQueueEntryFromTab(tab(), 1_700_000_000_000)
    expect(entry).toMatchObject({
      url: 'https://example.com/article',
      title: 'Example article',
      favicon: 'https://example.com/favicon.ico',
      addedAt: 1_700_000_000_000,
      source: 'manual',
    })
    expect(entry?.id).toBeTruthy()
  })

  it('falls back to the url when the tab has no title', () => {
    expect(readingQueueEntryFromTab(tab({ title: '' }))?.title).toBe('https://example.com/article')
  })

  it('refuses private tabs, non-http urls and empty tabs', () => {
    expect(readingQueueEntryFromTab(tab({ private: true }))).toBeNull()
    expect(readingQueueEntryFromTab(tab({ url: 'file:///tmp/a.pdf' }))).toBeNull()
    expect(readingQueueEntryFromTab(tab({ url: '' }))).toBeNull()
  })
})

describe('formatQueuedAt', () => {
  it('formats a timestamp and tolerates invalid input', () => {
    expect(formatQueuedAt(new Date(2026, 10, 2, 9, 41).getTime())).not.toBe('')
    expect(formatQueuedAt(Number.NaN)).toBe('')
  })
})

describe('queueHost', () => {
  it('strips www and falls back to the raw value', () => {
    expect(queueHost('https://www.example.com/a')).toBe('example.com')
    expect(queueHost('not a url')).toBe('not a url')
  })
})
