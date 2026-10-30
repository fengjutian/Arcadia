import { describe, expect, it } from 'vitest'
import type { PermissionRequest } from '../../services/nativeBrowser'
import { permissionPromptQueueReducer } from './permissionPromptQueue'

const request = (requestId: string): PermissionRequest => ({
  version: 1,
  requestId,
  origin: 'https://example.com',
  kind: 'camera',
})

describe('permissionPromptQueueReducer', () => {
  it('keeps the first request at the head while later ones wait', () => {
    let queue = permissionPromptQueueReducer([], { type: 'enqueue', request: request('a') })
    queue = permissionPromptQueueReducer(queue, { type: 'enqueue', request: request('b') })
    expect(queue.map(item => item.requestId)).toEqual(['a', 'b'])
  })

  it('advances to the next request after the head is dismissed', () => {
    const queue = [request('a'), request('b')]
    expect(
      permissionPromptQueueReducer(queue, { type: 'dismiss', requestId: 'a' }).map(item => item.requestId),
    ).toEqual(['b'])
  })

  it('does not re-show the dismissed request when the head was already removed', () => {
    // Regression: the old implementation pushed the displayed request but
    // never removed it, so deciding shifted the same request back to the head.
    const queue = [request('a'), request('b')]
    const afterFirst = permissionPromptQueueReducer(queue, { type: 'dismiss', requestId: 'a' })
    const afterSecond = permissionPromptQueueReducer(afterFirst, { type: 'dismiss', requestId: 'a' })
    expect(afterSecond.map(item => item.requestId)).toEqual(['b'])
  })

  it('drops a queued request that is dismissed before reaching the head', () => {
    const queue = [request('a'), request('b'), request('c')]
    expect(
      permissionPromptQueueReducer(queue, { type: 'dismiss', requestId: 'b' }).map(item => item.requestId),
    ).toEqual(['a', 'c'])
  })

  it('is a no-op on an empty queue', () => {
    expect(permissionPromptQueueReducer([], { type: 'dismiss', requestId: 'missing' })).toEqual([])
  })
})
