import { describe, expect, it } from 'vitest'
import type { BrowserTab } from '../../types'
import { isPageNewWindowUrl, isPristineNewTab, reusableNewTabId } from './newTabTarget'

function tab(overrides: Partial<BrowserTab> = {}): BrowserTab {
  return {
    id: 't1',
    url: '',
    title: '新标签页',
    loading: false,
    active: true,
    pinned: false,
    ...overrides,
  }
}

describe('isPageNewWindowUrl', () => {
  it('accepts real http(s) navigations', () => {
    expect(isPageNewWindowUrl('https://juejin.cn/post/1')).toBe(true)
    expect(isPageNewWindowUrl('http://example.com')).toBe(true)
    expect(isPageNewWindowUrl('  https://example.com/x  ')).toBe(true)
  })

  it('rejects popups that are not links', () => {
    expect(isPageNewWindowUrl('about:blank')).toBe(false)
    expect(isPageNewWindowUrl('')).toBe(false)
    expect(isPageNewWindowUrl('   ')).toBe(false)
    expect(isPageNewWindowUrl('javascript:void(0)')).toBe(false)
    expect(isPageNewWindowUrl('data:text/html,hi')).toBe(false)
    expect(isPageNewWindowUrl(undefined)).toBe(false)
    expect(isPageNewWindowUrl(null)).toBe(false)
  })
})

describe('isPristineNewTab', () => {
  it('accepts an untouched new-tab page', () => {
    expect(isPristineNewTab(tab())).toBe(true)
    expect(isPristineNewTab(tab({ url: '   ' }))).toBe(true)
  })

  it('rejects tabs that are already doing something', () => {
    expect(isPristineNewTab(undefined)).toBe(false)
    expect(isPristineNewTab(tab({ url: 'https://example.com' }))).toBe(false)
    expect(isPristineNewTab(tab({ loading: true }))).toBe(false)
    expect(isPristineNewTab(tab({ pinned: true }))).toBe(false)
    expect(isPristineNewTab(tab({ suspended: true }))).toBe(false)
    expect(isPristineNewTab(tab({ crashed: true }))).toBe(false)
    expect(isPristineNewTab(tab({ error: { kind: 'load-failed', message: 'x' } }))).toBe(false)
  })
})

describe('reusableNewTabId', () => {
  it('reuses the active pristine new tab', () => {
    expect(reusableNewTabId([tab()], 't1')).toBe('t1')
  })

  it('does not reuse a tab the user already navigated', () => {
    expect(reusableNewTabId([tab({ url: 'https://example.com' })], 't1')).toBeUndefined()
  })

  it('never reuses for background or private requests', () => {
    expect(reusableNewTabId([tab()], 't1', { background: true })).toBeUndefined()
    expect(reusableNewTabId([tab()], 't1', { private: true })).toBeUndefined()
    expect(reusableNewTabId([tab({ private: true })], 't1')).toBeUndefined()
  })

  it('ignores an unknown or missing active tab', () => {
    expect(reusableNewTabId([tab()], 'other')).toBeUndefined()
    expect(reusableNewTabId([tab()], undefined)).toBeUndefined()
    expect(reusableNewTabId([], 't1')).toBeUndefined()
  })
})
