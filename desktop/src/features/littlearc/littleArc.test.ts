import { afterEach, describe, expect, it } from 'vitest'
import { LITTLE_ARC_STORAGE_KEY, isLittleArcWindow, isSensitiveHost, readLittleArcPayload } from './littleArc'

afterEach(() => {
  window.history.replaceState({}, '', '/')
  localStorage.clear()
})

describe('Little Arc window detection', () => {
  it('only matches the little-arc query flag', () => {
    expect(isLittleArcWindow()).toBe(false)
    window.history.replaceState({}, '', '/?window=little-arc')
    expect(isLittleArcWindow()).toBe(true)
    window.history.replaceState({}, '', '/?window=ai-assistant')
    expect(isLittleArcWindow()).toBe(false)
  })
})

describe('readLittleArcPayload', () => {
  it('round-trips a URL and tolerates corrupt storage', () => {
    expect(readLittleArcPayload()).toBeNull()
    localStorage.setItem(LITTLE_ARC_STORAGE_KEY, JSON.stringify({ url: 'https://example.com' }))
    expect(readLittleArcPayload()).toEqual({ url: 'https://example.com' })
    localStorage.setItem(LITTLE_ARC_STORAGE_KEY, '{oops')
    expect(readLittleArcPayload()).toBeNull()
  })
})

describe('isSensitiveHost', () => {
  it('flags banking, payment and webmail hosts', () => {
    expect(isSensitiveHost('https://my.bank.example/login')).toBe(true)
    expect(isSensitiveHost('https://paypal.com/checkout')).toBe(true)
    expect(isSensitiveHost('https://mail.google.com')).toBe(true)
    expect(isSensitiveHost('https://example.com/article')).toBe(false)
    expect(isSensitiveHost('not a url')).toBe(false)
  })
})
