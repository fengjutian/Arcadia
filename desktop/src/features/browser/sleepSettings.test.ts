import { beforeEach, describe, expect, it } from 'vitest'
import {
  SLEEP_EXCEPTIONS_STORAGE_KEY,
  isSleepExcluded,
  normalizeSleepHost,
  readSleepExceptions,
  toggleSleepException,
  writeSleepExceptions,
} from './sleepSettings'

beforeEach(() => localStorage.clear())

describe('normalizeSleepHost', () => {
  it('lowercases and strips www', () => {
    expect(normalizeSleepHost('https://WWW.Example.com/path')).toBe('example.com')
    expect(normalizeSleepHost('https://sub.example.com')).toBe('sub.example.com')
  })

  it('returns null for invalid or empty input', () => {
    expect(normalizeSleepHost('not a url')).toBeNull()
    expect(normalizeSleepHost('')).toBeNull()
  })
})

describe('read/writeSleepExceptions', () => {
  it('round-trips and de-duplicates', () => {
    expect(readSleepExceptions()).toEqual([])
    writeSleepExceptions(['example.com', 'WWW.example.com', ' other.com '])
    expect(readSleepExceptions()).toEqual(['example.com', 'other.com'])
  })

  it('survives corrupt payloads', () => {
    localStorage.setItem(SLEEP_EXCEPTIONS_STORAGE_KEY, '{oops')
    expect(readSleepExceptions()).toEqual([])
    localStorage.setItem(SLEEP_EXCEPTIONS_STORAGE_KEY, '{"a":1}')
    expect(readSleepExceptions()).toEqual([])
  })
})

describe('toggleSleepException', () => {
  it('adds then removes the host', () => {
    const added = toggleSleepException([], 'https://www.example.com/a')
    expect(added).toEqual(['example.com'])
    expect(toggleSleepException(added, 'https://example.com/b')).toEqual([])
  })

  it('ignores invalid urls without mutating the input', () => {
    const list = ['example.com']
    expect(toggleSleepException(list, 'not a url')).toEqual(['example.com'])
    expect(list).toEqual(['example.com'])
  })
})

describe('isSleepExcluded', () => {
  it('matches by normalised host', () => {
    expect(isSleepExcluded('https://www.example.com', ['example.com'])).toBe(true)
    expect(isSleepExcluded('https://other.com', ['example.com'])).toBe(false)
    expect(isSleepExcluded('nope', ['example.com'])).toBe(false)
  })
})
