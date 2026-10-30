import { describe, expect, it } from 'vitest'
import { shouldRecordHistory } from './historyRecording'

const base = { url: 'https://example.com/article', title: 'Example Article', loading: false }

describe('shouldRecordHistory', () => {
  it('records a loaded http page whose URL changed', () => {
    expect(shouldRecordHistory(base, 'https://previous.example')).toBe(true)
  })

  it('waits while the page is still loading', () => {
    expect(shouldRecordHistory({ ...base, loading: true }, 'https://previous.example')).toBe(false)
  })

  it('does not record the same URL twice', () => {
    expect(shouldRecordHistory(base, base.url)).toBe(false)
  })

  it('never records private tabs', () => {
    expect(shouldRecordHistory({ ...base, private: true }, 'https://previous.example')).toBe(false)
  })

  it('skips error pages and non-http protocols', () => {
    expect(shouldRecordHistory({ ...base, error: { kind: 'timeout' } }, '')).toBe(false)
    expect(shouldRecordHistory({ ...base, url: 'file:///tmp/doc.pdf' }, '')).toBe(false)
  })
})
