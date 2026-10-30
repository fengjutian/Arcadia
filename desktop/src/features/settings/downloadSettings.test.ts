import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DOWNLOAD_SETTINGS_EVENT, DOWNLOAD_SETTINGS_KEY, readDownloadSettings, writeDownloadSettings } from './downloadSettings'

describe('download settings', () => {
  beforeEach(() => localStorage.clear())

  it('merges stored values with safe defaults', () => {
    localStorage.setItem(DOWNLOAD_SETTINGS_KEY, JSON.stringify({ askWhereToSave: true }))
    expect(readDownloadSettings()).toEqual({ directory: '', askWhereToSave: true, openOfficeInBrowser: false, showPanelOnStart: true })
  })

  it('persists and broadcasts changes', () => {
    const listener = vi.fn()
    window.addEventListener(DOWNLOAD_SETTINGS_EVENT, listener)
    const next = { directory: 'D:\\Downloads', askWhereToSave: false, openOfficeInBrowser: true, showPanelOnStart: false }
    writeDownloadSettings(next)
    expect(readDownloadSettings()).toEqual(next)
    expect(listener).toHaveBeenCalledOnce()
    window.removeEventListener(DOWNLOAD_SETTINGS_EVENT, listener)
  })
})
