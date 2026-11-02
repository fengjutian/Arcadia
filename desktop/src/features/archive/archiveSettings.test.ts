import { beforeEach, describe, expect, it } from 'vitest'
import {
  AUTO_ARCHIVE_DEFAULT,
  AUTO_ARCHIVE_STORAGE_KEY,
  idleMsFor,
  normalizeAutoArchiveSettings,
  readAutoArchiveSettings,
  writeAutoArchiveSettings,
} from './archiveSettings'

beforeEach(() => localStorage.clear())

describe('normalizeAutoArchiveSettings', () => {
  it('falls back to the default for junk input', () => {
    expect(normalizeAutoArchiveSettings(null)).toEqual(AUTO_ARCHIVE_DEFAULT)
    expect(normalizeAutoArchiveSettings('nope')).toEqual(AUTO_ARCHIVE_DEFAULT)
    expect(normalizeAutoArchiveSettings({ idleHours: 0 })).toEqual(AUTO_ARCHIVE_DEFAULT)
    expect(normalizeAutoArchiveSettings({ idleHours: -3 })).toEqual(AUTO_ARCHIVE_DEFAULT)
  })

  it('keeps valid values and coerces numeric strings', () => {
    expect(normalizeAutoArchiveSettings({ enabled: false, idleHours: 72 })).toEqual({ enabled: false, idleHours: 72, retention: 2000 })
    expect(normalizeAutoArchiveSettings({ enabled: true, idleHours: '24', retention: 500 })).toEqual({ enabled: true, idleHours: 24, retention: 500 })
  })

  it('clamps the retention window', () => {
    expect(normalizeAutoArchiveSettings({ retention: 10 }).retention).toBe(2000)
    expect(normalizeAutoArchiveSettings({ retention: 999999 }).retention).toBe(2000)
    expect(normalizeAutoArchiveSettings({ retention: '5000' }).retention).toBe(5000)
  })
})

describe('read/writeAutoArchiveSettings', () => {
  it('round-trips through localStorage', () => {
    expect(readAutoArchiveSettings()).toEqual(AUTO_ARCHIVE_DEFAULT)
    const next = { enabled: false, idleHours: 24, retention: 5000 }
    writeAutoArchiveSettings(next)
    expect(readAutoArchiveSettings()).toEqual(next)
    expect(JSON.parse(localStorage.getItem(AUTO_ARCHIVE_STORAGE_KEY)!)).toEqual(next)
  })

  it('survives a corrupted payload', () => {
    localStorage.setItem(AUTO_ARCHIVE_STORAGE_KEY, '{not json')
    expect(readAutoArchiveSettings()).toEqual(AUTO_ARCHIVE_DEFAULT)
  })
})

describe('idleMsFor', () => {
  it('converts hours to milliseconds', () => {
    expect(idleMsFor({ enabled: true, idleHours: 12, retention: 2000 })).toBe(12 * 60 * 60 * 1000)
  })
})
