import { describe, expect, it } from 'vitest'
import { classifyNavigationError } from './navigationErrors'
import { isMissingWebviewError } from './tabViewErrors'

describe('classifyNavigationError', () => {
  it('parses the site blacklist error contract', () => {
    const error = classifyNavigationError('site-blocked:a.example.com|example.com|id-1')
    expect(error.kind).toBe('site-blocked')
    expect(error.host).toBe('a.example.com')
    expect(error.ruleHost).toBe('example.com')
    expect(error.entryId).toBe('id-1')
    expect(error.message).toContain('example.com')
  })

  it('keeps the unsupported protocol branch distinct', () => {
    const error = classifyNavigationError('blocked-protocol:file')
    expect(error.kind).toBe('unsupported-protocol')
  })

  it('falls back to load-failed for unknown errors', () => {
    expect(classifyNavigationError('boom').kind).toBe('load-failed')
  })

  it('maps Tauri core "webview not found" to a dedicated kind with friendly copy', () => {
    const error = classifyNavigationError('webview not found')
    expect(error.kind).toBe('tab-view-missing')
    expect(error.message).not.toContain('webview not found')
    expect(error.message).toContain('重试')
  })

  it('maps the Rust-side "browser tab webview not found" variant too', () => {
    expect(classifyNavigationError('browser tab webview not found').kind).toBe('tab-view-missing')
  })

  it('does not mistake unrelated errors for a missing view', () => {
    expect(isMissingWebviewError('net::ERR_CONNECTION_REFUSED')).toBe(false)
    expect(classifyNavigationError('net::ERR_CONNECTION_REFUSED').kind).toBe('load-failed')
  })
})
