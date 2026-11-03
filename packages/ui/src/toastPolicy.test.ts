import { describe, expect, it } from 'vitest'
import { MAX_VISIBLE_TOASTS, repeatedContentKey, trimToVisible } from './toastPolicy'

describe('repeatedContentKey', () => {
  it('folds plain text repeats', () => {
    expect(repeatedContentKey('菜单浮层加载失败')).toBe('菜单浮层加载失败')
    expect(repeatedContentKey('已复制链接')).toBe(repeatedContentKey('已复制链接'))
  })

  it('never folds rich content or empty text', () => {
    const node = { type: 'span', props: {} }
    expect(repeatedContentKey(node)).toBeUndefined()
    expect(repeatedContentKey('')).toBeUndefined()
    expect(repeatedContentKey(null)).toBeUndefined()
    expect(repeatedContentKey(undefined)).toBeUndefined()
  })

  it('keeps different messages apart', () => {
    expect(repeatedContentKey('已复制链接')).not.toBe(repeatedContentKey('已复制图片'))
  })
})

describe('trimToVisible', () => {
  it('leaves short stacks untouched', () => {
    expect(trimToVisible(['a', 'b'])).toEqual(['a', 'b'])
  })

  it('keeps the newest rows once the stack is full', () => {
    const rows = ['a', 'b', 'c', 'd', 'e']
    expect(trimToVisible(rows)).toEqual(rows.slice(-MAX_VISIBLE_TOASTS))
    expect(trimToVisible(rows)).toEqual(['c', 'd', 'e'])
  })
})
