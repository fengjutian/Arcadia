import { describe, expect, it } from 'vitest'
import type { BrowserTab } from '../../types'
import { AUTO_ARCHIVE_IDLE_MS, planAutoArchive } from './autoArchive'

function tab(patch: Partial<BrowserTab> & Pick<BrowserTab, 'id'>): BrowserTab {
  return {
    url: `https://example.com/${patch.id}`,
    title: patch.id,
    loading: false,
    active: false,
    pinned: false,
    ...patch,
  }
}

const HOUR = 60 * 60 * 1000
const now = 1_700_000_000_000

describe('planAutoArchive', () => {
  it('archives tabs idle past the threshold', () => {
    const tabs = [
      tab({ id: 'stale', lastActiveAt: now - AUTO_ARCHIVE_IDLE_MS - 1 }),
      tab({ id: 'fresh', lastActiveAt: now - HOUR }),
    ]
    expect(planAutoArchive(tabs, 'other', now)).toEqual(['stale'])
  })

  it('never archives the active tab', () => {
    const tabs = [tab({ id: 'active', lastActiveAt: now - AUTO_ARCHIVE_IDLE_MS * 2 })]
    expect(planAutoArchive(tabs, 'active', now)).toEqual([])
  })

  it('keeps pinned, private, audible, loading and crashed tabs', () => {
    const stale = now - AUTO_ARCHIVE_IDLE_MS * 2
    const tabs = [
      tab({ id: 'pinned', pinned: true, lastActiveAt: stale }),
      tab({ id: 'private', private: true, lastActiveAt: stale }),
      tab({ id: 'audible', audible: true, lastActiveAt: stale }),
      tab({ id: 'muted-audible', audible: true, muted: true, lastActiveAt: stale }),
      tab({ id: 'loading', loading: true, lastActiveAt: stale }),
      tab({ id: 'crashed', crashed: true, lastActiveAt: stale }),
    ]
    expect(planAutoArchive(tabs, 'other', now)).toEqual(['muted-audible'])
  })

  it('ignores tabs without a recorded timestamp or with non-http urls', () => {
    const tabs = [
      tab({ id: 'untimed' }),
      tab({ id: 'file', url: 'file:///tmp/a.md', lastActiveAt: now - AUTO_ARCHIVE_IDLE_MS * 2 }),
      tab({ id: 'blank', url: '', lastActiveAt: now - AUTO_ARCHIVE_IDLE_MS * 2 }),
    ]
    expect(planAutoArchive(tabs, 'other', now)).toEqual([])
  })

  it('respects a custom threshold', () => {
    const tabs = [tab({ id: 'two-hours', lastActiveAt: now - 2 * HOUR })]
    expect(planAutoArchive(tabs, 'other', now, HOUR)).toEqual(['two-hours'])
    expect(planAutoArchive(tabs, 'other', now, 3 * HOUR)).toEqual([])
  })
})
