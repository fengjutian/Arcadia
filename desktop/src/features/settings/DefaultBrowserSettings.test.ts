import { describe, expect, it } from 'vitest'
import type { DefaultBrowserStatus } from '../../services/defaultBrowser'
import { defaultBrowserLabel } from './DefaultBrowserSettings'

const STATUS: DefaultBrowserStatus = {
  platformSupported: true,
  isDefault: false,
  registered: true,
  currentProgId: 'ChromeHTML',
  currentAppName: 'Google Chrome',
}

describe('defaultBrowserLabel', () => {
  it('says Arcadia is default when Windows resolves web links to us', () => {
    expect(defaultBrowserLabel({ ...STATUS, isDefault: true, currentProgId: 'ArcadiaHTML', currentAppName: 'Arcadia' }))
      .toBe('Arcadia 已是默认浏览器')
  })

  it('names the browser that currently owns web links', () => {
    expect(defaultBrowserLabel(STATUS)).toBe('当前默认浏览器：Google Chrome')
  })

  it('falls back to the raw ProgID when the product is unknown', () => {
    expect(defaultBrowserLabel({ ...STATUS, currentAppName: null, currentProgId: 'SomeVendor.Browser' }))
      .toBe('当前默认浏览器：SomeVendor.Browser')
  })

  it('reports a missing default instead of inventing one', () => {
    expect(defaultBrowserLabel({ ...STATUS, currentProgId: null, currentAppName: null }))
      .toBe('尚未检测到系统默认浏览器')
  })

  it('handles unsupported platforms and the loading state', () => {
    expect(defaultBrowserLabel({ ...STATUS, platformSupported: false })).toBe('当前系统不支持在这里设置默认浏览器')
    expect(defaultBrowserLabel(null)).toBe('正在读取默认浏览器…')
  })
})
