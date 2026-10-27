import { describe, expect, it } from 'vitest'
import { classifyNavigationError } from './navigationErrors'

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
})
