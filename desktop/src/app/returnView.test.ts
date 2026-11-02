import { describe, expect, it } from 'vitest'
import { rememberViewForReload, takeViewAfterReload } from './returnView'

describe('return view across reload', () => {
  it('restores the remembered route exactly once', () => {
    rememberViewForReload('settings')
    expect(takeViewAfterReload()).toBe('settings')
    expect(takeViewAfterReload()).toBeNull()
  })

  it('ignores unknown routes', () => {
    sessionStorage.setItem('arcadia-return-view', 'not-a-view')
    expect(takeViewAfterReload()).toBeNull()
  })

  it('returns null when nothing was remembered', () => {
    sessionStorage.removeItem('arcadia-return-view')
    expect(takeViewAfterReload()).toBeNull()
  })
})
