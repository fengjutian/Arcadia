import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  emptySnapshot,
  readLatestSnapshot,
  readRecoverySnapshot,
  restoreFromSnapshot,
  SESSION_KEY_V1,
  SESSION_KEY_V2,
  SESSION_SCHEMA_VERSION,
  stripTransientTabState,
  writeSnapshot,
  type SessionSnapshot,
} from './sessionStore'

const sample: SessionSnapshot = {
  schemaVersion: SESSION_SCHEMA_VERSION,
  savedAt: 1_000_000,
  windows: [
    {
      id: 'win-1',
      tabs: [
        { id: 'a', url: 'https://a.example', title: 'A', loading: false, active: false, pinned: false },
        { id: 'b', url: 'https://b.example', title: 'B', loading: false, active: false, pinned: true },
        { id: 'priv', url: 'https://c.example', title: 'C', loading: false, active: false, pinned: false, private: true },
      ],
      activeTabId: 'b',
      scrollPositions: { a: { x: 0, y: 120 } },
      zoomLevels: { a: 1.25 },
    },
  ],
  history: [],
  closedTabs: [],
}

describe('writeSnapshot + readLatestSnapshot', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => localStorage.clear())

  it('writes to v1 on the first call', () => {
    writeSnapshot(sample, { rotatedAt: 1_000_000 })
    expect(localStorage.getItem(SESSION_KEY_V1)).not.toBeNull()
    expect(localStorage.getItem(SESSION_KEY_V2)).toBeNull()
    const result = readLatestSnapshot()
    expect(result?.source).toBe('v1')
    expect(result?.snapshot.savedAt).toBe(1_000_000)
  })

  it('rotates after the second write', () => {
    writeSnapshot(sample, { rotatedAt: 1_000_000 })
    writeSnapshot({ ...sample, savedAt: 2_000_000 }, { rotatedAt: 2_000_000 })
    const v2Raw = localStorage.getItem(SESSION_KEY_V2)
    const v1Raw = localStorage.getItem(SESSION_KEY_V1)
    expect(v2Raw).not.toBeNull()
    expect(v1Raw).not.toBeNull()
  })

  it('flags suspect when slots diverge by > 5 s', () => {
    localStorage.setItem(SESSION_KEY_V1, JSON.stringify({ ...sample, savedAt: 1_000_000 }))
    localStorage.setItem(SESSION_KEY_V2, JSON.stringify({ ...sample, savedAt: 1_000_010 }))
    const result = readLatestSnapshot()
    expect(result?.suspect).toBe(false)
    localStorage.setItem(SESSION_KEY_V2, JSON.stringify({ ...sample, savedAt: 1_000_000 }))
    localStorage.setItem(SESSION_KEY_V1, JSON.stringify({ ...sample, savedAt: 900_000 }))
    const drifted = readLatestSnapshot()
    expect(drifted?.source).toBe('v2')
    expect(drifted?.suspect).toBe(true)
  })

  it('ignores corrupt slots', () => {
    localStorage.setItem(SESSION_KEY_V1, 'not-json')
    expect(readLatestSnapshot()).toBeNull()
  })

  it('ignores snapshots with the wrong schema version', () => {
    localStorage.setItem(SESSION_KEY_V1, JSON.stringify({ ...sample, schemaVersion: 1 }))
    expect(readLatestSnapshot()).toBeNull()
  })

  it('prefers an older navigable snapshot over a newer blank placeholder', () => {
    localStorage.setItem(SESSION_KEY_V1, JSON.stringify({ ...sample, savedAt: 1_000_000 }))
    localStorage.setItem(SESSION_KEY_V2, JSON.stringify({
      ...sample,
      savedAt: 2_000_000,
      windows: [{ ...sample.windows[0], tabs: [{ id: 'new', url: '', title: 'New tab', loading: false, active: true, pinned: false }], activeTabId: 'new' }],
    }))
    const result = readRecoverySnapshot()
    expect(result?.source).toBe('v1')
    expect(result?.snapshot.windows[0].tabs[0].url).toBe('https://a.example')
    expect(result?.suspect).toBe(true)
  })
})

describe('restoreFromSnapshot', () => {
  it('strips private tabs and falls back to the first tab when active was removed', () => {
    const restored = restoreFromSnapshot(sample)
    expect(restored.tabs.map(tab => tab.id)).toEqual(['a', 'b'])
    expect(restored.activeTabId).toBe('b')
    expect(restored.skipped).toBe(1)
    expect(restored.zoomLevels.a).toBe(1.25)
  })

  it('returns an empty session when no windows are stored', () => {
    const empty = emptySnapshot()
    const restored = restoreFromSnapshot(empty)
    expect(restored.tabs).toEqual([])
    expect(restored.activeTabId).toBe('')
  })

  it('falls back to the first tab when the active id was private', () => {
    const onlyPrivate: SessionSnapshot = {
      ...sample,
      windows: [{ ...sample.windows[0], tabs: sample.windows[0].tabs.filter(tab => tab.private), activeTabId: 'priv' }],
    }
    const restored = restoreFromSnapshot(onlyPrivate)
    expect(restored.tabs).toEqual([])
    expect(restored.skipped).toBe(1)
  })

  it('drops stale runtime error/crash state restored from disk', () => {
    const poisoned: SessionSnapshot = {
      ...sample,
      windows: [{
        ...sample.windows[0],
        tabs: [
          { ...sample.windows[0].tabs[0], error: { kind: 'tab-view-missing', message: 'webview not found' }, crashed: true },
          sample.windows[0].tabs[1],
        ],
      }],
    }
    const restored = restoreFromSnapshot(poisoned)
    expect(restored.tabs[0].error).toBeUndefined()
    expect(restored.tabs[0].crashed).toBe(false)
  })
})

describe('stripTransientTabState', () => {
  it('returns the same object when there is nothing to strip', () => {
    const tab = { id: 'a', url: '', title: 'A', loading: false, active: true, pinned: false }
    expect(stripTransientTabState(tab)).toBe(tab)
  })

  it('removes error and resets crashed without touching other fields', () => {
    const tab = {
      id: 'a', url: 'https://a.example', title: 'A', loading: false, active: true, pinned: false,
      crashed: true, error: { kind: 'load-failed' as const, message: 'boom' },
    }
    const cleaned = stripTransientTabState(tab)
    expect(cleaned.error).toBeUndefined()
    expect(cleaned.crashed).toBe(false)
    expect(cleaned.url).toBe('https://a.example')
  })

  it('does not persist error state through writeSnapshot', () => {
    localStorage.clear()
    writeSnapshot({
      ...sample,
      windows: [{
        ...sample.windows[0],
        tabs: [{ ...sample.windows[0].tabs[0], error: { kind: 'load-failed', message: 'webview not found' } }],
      }],
    }, { rotatedAt: 1_000_000 })
    const raw = localStorage.getItem(SESSION_KEY_V1) ?? ''
    expect(raw).not.toContain('"error"')
    localStorage.clear()
  })
})
