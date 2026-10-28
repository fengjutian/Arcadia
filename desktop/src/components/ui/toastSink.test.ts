import { describe, expect, it, vi } from 'vitest'
import { activeToastSink, registerToastSink, type ToastSink, type ToastSinkPayload } from './toastSink'

const payload: ToastSinkPayload = { id: 'a', kind: 'success', text: '已复制链接', durationMs: 3000, theme: 'light' }

function sink(): ToastSink {
  return { show: vi.fn(() => true), hide: vi.fn() }
}

describe('toast sink registry', () => {
  it('has no sink until the browser route registers one', () => {
    expect(activeToastSink()).toBeNull()
  })

  it('hands the payload to the registered sink', () => {
    const target = sink()
    const release = registerToastSink(target)
    expect(activeToastSink()).toBe(target)
    expect(activeToastSink()?.show(payload)).toBe(true)
    expect(target.show).toHaveBeenCalledWith(payload)
    release()
    expect(activeToastSink()).toBeNull()
  })

  it('does not let a stale cleanup unregister a newer sink', () => {
    const first = sink()
    const releaseFirst = registerToastSink(first)
    const second = sink()
    registerToastSink(second)
    releaseFirst()
    expect(activeToastSink()).toBe(second)
  })

  it('stays clean when the same registration is released twice', () => {
    const release = registerToastSink(sink())
    release()
    release()
    expect(activeToastSink()).toBeNull()
  })
})
