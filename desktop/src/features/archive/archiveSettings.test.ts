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
    expect(normalizeAutoArchiveSettings({ enabled: false, idleHours: 72 })).toEqual({ enabled: false, idleHours: 72 })
    expect(normalizeAutoArchiveSettings({ enabled: true, idleHours: '24' })).toEqual({ enabled: true, idleHours: 24 })
  })
})

describe('read/writeAutoArchiveSettings', () => {
  it('round-trips through localStorage', () => {
    expect(readAutoArchiveSettings()).toEqual(AUTO_ARCHIVE_DEFAULT)
    writeAutoArchiveSettings({ enabled: false, idleHours: 24 })
    expect(readAutoArchiveSettings()).toEqual({ enabled: false, idleHours: 24 })
    expect(JSON.parse(localStorage.getItem(AUTO_ARCHIVE_STORAGE_KEY)!)).toEqual({ enabled: false, idleHours: 24 })
  })

  it('survives a corrupted payload', () => {
    localStorage.setItem(AUTO_ARCHIVE_STORAGE_KEY, '{not json')
    expect(readAutoArchiveSettings()).toEqual(AUTO_ARCHIVE_DEFAULT)
  })
})

describe('idleMsFor', () => {
  it('converts hours to milliseconds', () => {
    expect(idleMsFor({ enabled: true, idleHours: 12 })).toBe(12 * 60 * 60 * 1000)
  })
})
