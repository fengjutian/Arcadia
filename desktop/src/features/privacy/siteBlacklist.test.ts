import { describe, expect, it } from 'vitest'
import type { SiteBlacklistEntry } from '../../api'
import { hostFromUrl, matchSiteBlacklist, normalizeHost } from './siteBlacklist'

function entry(overrides: Partial<SiteBlacklistEntry> & { host: string }): SiteBlacklistEntry {
  return {
    id: `id-${overrides.host}`,
    includeSubdomains: true,
    enabled: true,
    note: null,
    source: 'manual',
    hitCount: 0,
    lastBlockedAt: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

describe('site blacklist host helpers', () => {
  it('normalizes case, brackets and the root dot', () => {
    expect(normalizeHost('Example.COM.')).toBe('example.com')
    expect(normalizeHost('[::1]')).toBe('::1')
  })

  it('extracts hosts only from http(s) URLs', () => {
    expect(hostFromUrl('https://www.Example.com/path?q=1')).toBe('www.example.com')
    expect(hostFromUrl('http://127.0.0.1:8080/')).toBe('127.0.0.1')
    expect(hostFromUrl('file:///etc/passwd')).toBeNull()
    expect(hostFromUrl('about:blank')).toBeNull()
    expect(hostFromUrl('not a url')).toBeNull()
  })

  it('keeps IDN hosts in punycode form', () => {
    const host = hostFromUrl('https://例子.测试/')
    expect(host).toBe('xn--fsqu00a.xn--0zwm56d')
    expect(matchSiteBlacklist('https://例子.测试/x', [entry({ host: 'xn--fsqu00a.xn--0zwm56d' })])).not.toBeNull()
  })
})

describe('matchSiteBlacklist', () => {
  const rules = [entry({ host: 'example.com' }), entry({ host: 'news.example.com', includeSubdomains: false })]

  it('matches the exact host and subdomains', () => {
    expect(matchSiteBlacklist('https://example.com/a', rules)?.host).toBe('example.com')
    expect(matchSiteBlacklist('https://deep.sub.example.com/', rules)?.host).toBe('example.com')
  })

  it('respects the includeSubdomains flag', () => {
    expect(matchSiteBlacklist('https://news.example.com/x', rules)?.host).toBe('news.example.com')
    // The narrower rule does not cover child hosts, but the broader
    // example.com rule still does.
    expect(matchSiteBlacklist('https://a.news.example.com/x', rules)?.host).toBe('example.com')
    const onlyNarrow = [entry({ host: 'news.example.com', includeSubdomains: false })]
    expect(matchSiteBlacklist('https://a.news.example.com/x', onlyNarrow)).toBeNull()
  })

  it('does not match a suffix without a dot boundary', () => {
    expect(matchSiteBlacklist('https://notexample.com/', rules)).toBeNull()
    expect(matchSiteBlacklist('https://example.org/', rules)).toBeNull()
  })

  it('returns the most specific rule first', () => {
    const nested = [entry({ host: 'example.com' }), entry({ host: 'news.example.com' })]
    // Array order must not decide: the matcher sorts by host length.
    expect(matchSiteBlacklist('https://news.example.com/x', nested)?.host).toBe('news.example.com')
  })

  it('ignores disabled entries and the global switch', () => {
    expect(matchSiteBlacklist('https://example.com/', [entry({ host: 'example.com', enabled: false })])).toBeNull()
    expect(matchSiteBlacklist('https://example.com/', rules, false)).toBeNull()
  })

  it('never matches internal or invalid URLs', () => {
    expect(matchSiteBlacklist('data:text/html,example.com', rules)).toBeNull()
    expect(matchSiteBlacklist('about:blank', rules)).toBeNull()
    expect(matchSiteBlacklist('not a url', rules)).toBeNull()
  })
})
