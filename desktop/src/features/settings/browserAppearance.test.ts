import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BROWSER_APPEARANCE_EVENT, BROWSER_APPEARANCE_KEY, readBrowserAppearance, writeBrowserAppearance } from './browserAppearance'

describe('browser appearance settings', () => {
  beforeEach(() => localStorage.clear())

  it('uses safe defaults and merges partial toolbar preferences', () => {
    localStorage.setItem(BROWSER_APPEARANCE_KEY, JSON.stringify({ defaultZoom: 9, toolbar: { ai: false } }))
    expect(readBrowserAppearance()).toEqual({
      defaultZoom: 3,
      toolbar: { reader: true, adBlock: true, ai: false, downloads: true, bookmarks: true, resources: true },
    })
  })

  it('persists normalized settings and announces changes', () => {
    const listener = vi.fn()
    window.addEventListener(BROWSER_APPEARANCE_EVENT, listener)
    const next = writeBrowserAppearance({ defaultZoom: 1.26, toolbar: { reader: false, adBlock: true, ai: true, downloads: true, bookmarks: true, resources: true } })
    expect(next.defaultZoom).toBe(1.3)
    expect(readBrowserAppearance()).toEqual(next)
    expect(listener).toHaveBeenCalledOnce()
    window.removeEventListener(BROWSER_APPEARANCE_EVENT, listener)
  })
})
