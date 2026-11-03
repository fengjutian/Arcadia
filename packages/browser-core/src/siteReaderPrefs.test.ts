import { beforeEach, describe, expect, it } from 'vitest'
import {
  READER_SITES_STORAGE_KEY,
  clampReaderFontSize,
  clampReaderWidth,
  hideCssFor,
  isAutoReaderSite,
  liveHideCssFor,
  normalizeHideSelectors,
  normalizeReaderHost,
  readReaderSiteStyles,
  readReaderSites,
  readerStyleFor,
  toggleReaderSite,
  writeReaderSiteStyle,
  writeReaderSites,
} from './siteReaderPrefs'

beforeEach(() => localStorage.clear())

describe('normalizeReaderHost', () => {
  it('accepts URLs and bare hosts, stripping www', () => {
    expect(normalizeReaderHost('https://www.example.com/a')).toBe('example.com')
    expect(normalizeReaderHost('example.com/path')).toBe('example.com')
    expect(normalizeReaderHost('  Sub.Example.com ')).toBe('sub.example.com')
  })

  it('rejects empty and invalid input', () => {
    expect(normalizeReaderHost('')).toBeNull()
    expect(normalizeReaderHost('   ')).toBeNull()
  })
})

describe('reader site list', () => {
  it('round-trips, de-duplicates and survives corruption', () => {
    expect(readReaderSites()).toEqual([])
    writeReaderSites(['example.com', 'EXAMPLE.com', 'other.com'])
    expect(readReaderSites()).toEqual(['example.com', 'other.com'])
    localStorage.setItem(READER_SITES_STORAGE_KEY, '{oops')
    expect(readReaderSites()).toEqual([])
    localStorage.setItem(READER_SITES_STORAGE_KEY, '{"a":1}')
    expect(readReaderSites()).toEqual([])
  })

  it('toggles a host and matches by URL', () => {
    const added = toggleReaderSite([], 'https://www.example.com/a')
    expect(added).toEqual(['example.com'])
    expect(isAutoReaderSite('https://example.com/b', added)).toBe(true)
    expect(isAutoReaderSite('https://other.com', added)).toBe(false)
    expect(toggleReaderSite(added, 'example.com')).toEqual([])
  })
})

describe('reader site styles', () => {
  it('clamps font size and width', () => {
    expect(clampReaderFontSize(8)).toBe(14)
    expect(clampReaderFontSize(40)).toBe(24)
    expect(clampReaderWidth(100)).toBe(640)
    expect(clampReaderWidth(5000)).toBe(1040)
  })

  it('round-trips a style per host and clears it', () => {
    expect(readReaderSiteStyles()).toEqual({})
    writeReaderSiteStyle('https://www.example.com/a', { fontSize: 20, width: 900 })
    expect(readerStyleFor('https://example.com/other')).toEqual({ fontSize: 20, width: 900 })
    expect(readerStyleFor('https://other.com')).toBeNull()
    writeReaderSiteStyle('example.com', null)
    expect(readerStyleFor('https://example.com')).toBeNull()
  })

  it('drops invalid stored values and corrupt payloads', () => {
    localStorage.setItem('arcadia.reader.siteStyle.v1', '{"example.com":{"fontSize":"big"}}')
    expect(readReaderSiteStyles()).toEqual({})
    localStorage.setItem('arcadia.reader.siteStyle.v1', '[1]')
    expect(readReaderSiteStyles()).toEqual({})
  })
})

describe('reader hide selectors', () => {
  it('keeps simple selectors and drops declarations or markup', () => {
    expect(normalizeHideSelectors('.ad, #promo, .share')).toBe('.ad, #promo, .share')
    expect(normalizeHideSelectors('.ad{display:none}, <script>, .ok')).toBe('.ok')
    expect(normalizeHideSelectors(', ,')).toBe('')
  })

  it('builds scoped reader CSS and round-trips through storage', () => {
    expect(hideCssFor(null)).toBe('')
    expect(hideCssFor({ hide: '.ad, #promo' })).toBe('.reader-document__body .ad, .reader-document__body #promo { display: none !important; }')
    writeReaderSiteStyle('example.com', { hide: '.ad' })
    expect(readerStyleFor('https://example.com')).toMatchObject({ hide: '.ad' })
  })

  it('only emits live CSS when the user opted in', () => {
    expect(liveHideCssFor({ hide: '.ad' })).toBe('')
    expect(liveHideCssFor({ hide: '.ad', hideLive: true })).toBe('.ad { display: none !important; }')
    expect(liveHideCssFor({ hide: '.ad, #promo', hideLive: true })).toContain('#promo { display: none !important; }')
  })
})
