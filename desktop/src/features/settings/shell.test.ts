import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SHELL_SETTINGS,
  readShellSettings,
  SHELL_SETTINGS_EVENT,
  SHELL_SETTINGS_KEY,
  writeShellSettings,
} from './shell'

describe('shell settings', () => {
  beforeEach(() => localStorage.clear())

  it('shows the sidebar when nothing has been stored', () => {
    expect(readShellSettings()).toEqual(DEFAULT_SHELL_SETTINGS)
    expect(readShellSettings().sidebarVisible).toBe(true)
  })

  it('hides the sidebar only for an explicit false', () => {
    localStorage.setItem(SHELL_SETTINGS_KEY, JSON.stringify({ sidebarVisible: false }))
    expect(readShellSettings().sidebarVisible).toBe(false)

    localStorage.setItem(SHELL_SETTINGS_KEY, JSON.stringify({ sidebarVisible: 'no' }))
    expect(readShellSettings().sidebarVisible).toBe(true)
  })

  it('falls back to the defaults when the stored entry is corrupt', () => {
    localStorage.setItem(SHELL_SETTINGS_KEY, '{not json')
    expect(readShellSettings()).toEqual(DEFAULT_SHELL_SETTINGS)
  })

  it('persists the choice and announces it', () => {
    const listener = vi.fn()
    window.addEventListener(SHELL_SETTINGS_EVENT, listener)
    const next = writeShellSettings({ sidebarVisible: false })
    expect(next).toEqual({ sidebarVisible: false })
    expect(readShellSettings()).toEqual(next)
    expect(listener).toHaveBeenCalledOnce()
    window.removeEventListener(SHELL_SETTINGS_EVENT, listener)
  })
})
