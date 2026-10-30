import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { describePrompt, forceAllDenyFor, resetOrigin, shouldPersistPermissionDecision } from './usePermissionPrompt'
import type { PermissionRequest } from '../../services/nativeBrowser'
import { readSitePermissions, writeSitePermissions } from './sitePermissions'

const SAMPLE: PermissionRequest = {
  version: 1,
  requestId: 'req-1',
  origin: 'https://example.com',
  kind: 'camera',
}

describe('describePrompt', () => {
  it('returns Chinese labels and hostname', () => {
    const result = describePrompt(SAMPLE)
    expect(result.kindLabel).toBe('摄像头')
    expect(result.originLabel).toBe('example.com')
    expect(result.origin).toBe('https://example.com')
  })

  it('falls back to origin when the URL is malformed', () => {
    const result = describePrompt({ ...SAMPLE, origin: 'not-a-url' })
    expect(result.originLabel).toBe('not-a-url')
  })

  it('maps every kind to a label', () => {
    const kinds = ['camera', 'microphone', 'location', 'notifications', 'clipboard', 'media'] as const
    for (const kind of kinds) {
      const label = describePrompt({ ...SAMPLE, kind }).kindLabel
      expect(label.length).toBeGreaterThan(0)
    }
  })
})

describe('shouldPersistPermissionDecision', () => {
  it('persists allow/deny only for "always" decisions on supported kinds', () => {
    expect(shouldPersistPermissionDecision(SAMPLE, 'allow-always')).toBe('allow')
    expect(shouldPersistPermissionDecision(SAMPLE, 'deny-always')).toBe('deny')
    expect(shouldPersistPermissionDecision(SAMPLE, 'allow-once')).toBeNull()
    expect(shouldPersistPermissionDecision(SAMPLE, 'deny-once')).toBeNull()
    expect(shouldPersistPermissionDecision({ ...SAMPLE, kind: 'media' }, 'allow-always')).toBeNull()
  })

  it('never persists rules for private-tab requests', () => {
    expect(shouldPersistPermissionDecision({ ...SAMPLE, private: true }, 'allow-always')).toBeNull()
    expect(shouldPersistPermissionDecision({ ...SAMPLE, private: true }, 'deny-always')).toBeNull()
  })
})

describe('forceAllDenyFor + resetOrigin', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    localStorage.clear()
  })

  it('writes deny for every kind on the target origin only', () => {
    writeSitePermissions([
      {
        origin: 'https://example.com',
        camera: 'allow',
        microphone: 'allow',
        location: 'allow',
        notifications: 'allow',
        clipboard: 'allow',
      },
      {
        origin: 'https://other.com',
        camera: 'allow',
        microphone: 'allow',
        location: 'allow',
        notifications: 'allow',
        clipboard: 'allow',
      },
    ])
    forceAllDenyFor('https://example.com')
    const all = readSitePermissions()
    const target = all.find(rule => rule.origin === 'https://example.com')!
    const other = all.find(rule => rule.origin === 'https://other.com')!
    expect(target.camera).toBe('deny')
    expect(target.clipboard).toBe('deny')
    expect(other.camera).toBe('allow')
  })

  it('resetOrigin drops the rule entirely', () => {
    writeSitePermissions([
      {
        origin: 'https://example.com',
        camera: 'deny',
        microphone: 'deny',
        location: 'deny',
        notifications: 'deny',
        clipboard: 'deny',
      },
    ])
    resetOrigin('https://example.com')
    expect(readSitePermissions()).toEqual([])
  })

  it('forceAllDenyFor is a no-op when the origin has no rule', () => {
    writeSitePermissions([
      {
        origin: 'https://other.com',
        camera: 'allow',
        microphone: 'allow',
        location: 'allow',
        notifications: 'allow',
        clipboard: 'allow',
      },
    ])
    forceAllDenyFor('https://missing.com')
    expect(readSitePermissions()[0].camera).toBe('allow')
  })
})