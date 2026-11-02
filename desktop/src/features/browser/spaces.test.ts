import { beforeEach, describe, expect, it } from 'vitest'
import {
  SPACE_STORAGE_KEY,
  activeCollectionId,
  autoSpaceName,
  readCurrentSpace,
  readSpaceScopes,
  writeCurrentSpace,
  writeSpaceScope,
} from './spaces'

beforeEach(() => localStorage.clear())

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
})
