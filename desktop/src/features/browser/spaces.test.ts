import { beforeEach, describe, expect, it } from 'vitest'
import {
  SPACE_STORAGE_KEY,
  activeCollectionId,
  autoSpaceName,
  clearCurrentSpace,
  currentSpaceNamespace,
  documentInScope,
  hasAutoSavedSnapshot,
  readCurrentSpace,
  readSpaceIdentities,
  readSpaceScopes,
  rememberAutoSavedSnapshot,
  spaceColorFor,
  tabSnapshotSignature,
  writeCurrentSpace,
  writeSpaceIdentity,
  writeSpaceScope,
} from './spaces'

beforeEach(() => localStorage.clear())

describe('tabSnapshotSignature', () => {
  const tabs = [
    { url: 'https://a.test/', title: 'A', pinned: false },
    { url: 'https://b.test/', title: 'B', pinned: true },
  ]

  it('is stable for the same tab set', () => {
    expect(tabSnapshotSignature({ tabs })).toBe(tabSnapshotSignature({ tabs: [...tabs] }))
    expect(tabSnapshotSignature({ tabs })).not.toBe('')
  })

  it('changes with url, title, order or pinned state', () => {
    const base = tabSnapshotSignature({ tabs })
    expect(tabSnapshotSignature({ tabs: [{ ...tabs[0], url: 'https://c.test/' }, tabs[1]] })).not.toBe(base)
    expect(tabSnapshotSignature({ tabs: [{ ...tabs[0], title: 'A2' }, tabs[1]] })).not.toBe(base)
    expect(tabSnapshotSignature({ tabs: [tabs[1], tabs[0]] })).not.toBe(base)
    expect(tabSnapshotSignature({ tabs: [{ ...tabs[0], pinned: true }, tabs[1]] })).not.toBe(base)
  })

  it('is empty for an empty tab set', () => {
    expect(tabSnapshotSignature({ tabs: [] })).toBe('')
    expect(tabSnapshotSignature(null)).toBe('')
  })
})

describe('auto-save index', () => {
  it('remembers a snapshot so a repeated switch does not duplicate it', () => {
    const signature = tabSnapshotSignature({ tabs: [{ url: 'https://a.test/', title: 'A' }] })
    expect(hasAutoSavedSnapshot(signature)).toBe(false)
    rememberAutoSavedSnapshot(signature, 'ws-1')
    expect(hasAutoSavedSnapshot(signature)).toBe(true)
    // Another tab set is still considered unsaved.
    expect(hasAutoSavedSnapshot(tabSnapshotSignature({ tabs: [{ url: 'https://b.test/', title: 'B' }] }))).toBe(false)
    expect(hasAutoSavedSnapshot('')).toBe(false)
  })
})

describe('autoSpaceName', () => {
  it('formats month, day, hour and minute with padding', () => {
    expect(autoSpaceName(new Date(2026, 10, 2, 9, 5))).toBe('自动保存 11-02 09:05')
    expect(autoSpaceName(new Date(2026, 0, 31, 23, 59))).toBe('自动保存 01-31 23:59')
  })
})

describe('read/writeCurrentSpace', () => {
  it('round-trips a space badge', () => {
    expect(readCurrentSpace()).toBeNull()
    writeCurrentSpace({ id: 'w1', name: 'Research' })
    expect(readCurrentSpace()).toEqual({ id: 'w1', name: 'Research' })
    expect(JSON.parse(localStorage.getItem(SPACE_STORAGE_KEY)!)).toEqual({ id: 'w1', name: 'Research' })
  })

  it('clears the badge', () => {
    writeCurrentSpace({ id: 'w1', name: 'Research' })
    writeCurrentSpace(null)
    expect(readCurrentSpace()).toBeNull()
  })

  it('rejects corrupt payloads and empty fields', () => {
    localStorage.setItem(SPACE_STORAGE_KEY, '{nope')
    expect(readCurrentSpace()).toBeNull()
    localStorage.setItem(SPACE_STORAGE_KEY, '{"id":"","name":"x"}')
    expect(readCurrentSpace()).toBeNull()
    localStorage.setItem(SPACE_STORAGE_KEY, '{"id":"w1"}')
    expect(readCurrentSpace()).toBeNull()
  })
})

describe('space knowledge scopes', () => {
  it('binds a collection to a space and clears it', () => {
    expect(readSpaceScopes()).toEqual({})
    writeSpaceScope('w1', 'c1')
    writeSpaceScope('w2', 'c2')
    expect(readSpaceScopes()).toEqual({ w1: 'c1', w2: 'c2' })
    writeSpaceScope('w1', null)
    expect(readSpaceScopes()).toEqual({ w2: 'c2' })
  })

  it('resolves the active collection from the current space', () => {
    expect(activeCollectionId(null)).toBeNull()
    writeCurrentSpace({ id: 'w1', name: 'Research' })
    expect(activeCollectionId()).toBeNull()
    writeSpaceScope('w1', 'c9')
    expect(activeCollectionId()).toBe('c9')
    expect(activeCollectionId({ id: 'w2', name: 'Other' })).toBeNull()
  })

  it('ignores corrupt scope payloads', () => {
    localStorage.setItem('arcadia.space.scope.v1', '[1,2]')
    expect(readSpaceScopes()).toEqual({})
    localStorage.setItem('arcadia.space.scope.v1', '{"w1":42}')
    expect(readSpaceScopes()).toEqual({})
  })

  it('filters documents only when a scope is set', () => {
    expect(documentInScope(null, 'd1')).toBe(true)
    const scope = new Set(['d1'])
    expect(documentInScope(scope, 'd1')).toBe(true)
    expect(documentInScope(scope, 'd2')).toBe(false)
    expect(documentInScope(new Set(), 'd1')).toBe(false)
  })

  it('uses the space id as the conversation namespace', () => {
    expect(currentSpaceNamespace()).toBe('default')
    writeCurrentSpace({ id: 'w1', name: 'Research' })
    expect(currentSpaceNamespace()).toBe('w1')
    clearCurrentSpace()
    expect(readCurrentSpace()).toBeNull()
    expect(currentSpaceNamespace()).toBe('default')
  })

  it('stores a known identity color and ignores invalid ones', () => {
    expect(readSpaceIdentities()).toEqual({})
    writeSpaceIdentity('w1', { color: '#3b6fd4' })
    expect(spaceColorFor('w1')).toBe('#3b6fd4')
    expect(spaceColorFor('w2')).toBeNull()
    writeSpaceIdentity('w1', { color: 'red' })
    expect(readSpaceIdentities()).toEqual({})
    writeSpaceIdentity('w1', null)
    expect(spaceColorFor('w1')).toBeNull()
  })
})
