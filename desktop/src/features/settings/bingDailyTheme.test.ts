import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BING_DAILY_CHANGE_EVENT,
  loadBingDailyImage,
  readBingDailyHistory,
  readCachedBingDailyImage,
  selectBingDailyImage,
  type BingDailyImage,
} from './bingDailyTheme'

function image(date: string, url: string): BingDailyImage {
  return { date, url, title: `Daily ${date}`, copyright: '© Bing' }
}

describe('Bing daily image history', () => {
  beforeEach(() => localStorage.clear())

  it('makes the picked image active and keeps previously loaded images', () => {
    selectBingDailyImage(image('20261101', 'https://example.com/1.jpg'))
    selectBingDailyImage(image('20261102', 'https://example.com/2.jpg'))
    selectBingDailyImage(image('20261031', 'https://example.com/3.jpg'))

    expect(readCachedBingDailyImage()?.url).toBe('https://example.com/3.jpg')
    expect(readBingDailyHistory().map(item => item.url)).toEqual([
      'https://example.com/2.jpg',
      'https://example.com/1.jpg',
      'https://example.com/3.jpg',
    ])
  })

  it('notifies the app when a historical image becomes active', () => {
    const listener = vi.fn()
    window.addEventListener(BING_DAILY_CHANGE_EVENT, listener)
    selectBingDailyImage(image('20261102', 'https://example.com/2.jpg'))
    expect(listener).toHaveBeenCalledOnce()
    expect((listener.mock.calls[0][0] as CustomEvent<BingDailyImage>).detail.url).toBe('https://example.com/2.jpg')
    window.removeEventListener(BING_DAILY_CHANGE_EVENT, listener)
  })

  it('deduplicates by URL and caps the retained history', () => {
    for (let day = 1; day <= 14; day += 1) {
      selectBingDailyImage(image(`202611${String(day).padStart(2, '0')}`, `https://example.com/${day}.jpg`))
    }
    selectBingDailyImage(image('20261107', 'https://example.com/7.jpg'))

    const history = readBingDailyHistory()
    expect(history).toHaveLength(12)
    expect(new Set(history.map(item => item.url)).size).toBe(12)
    expect(history[0].url).toBe('https://example.com/14.jpg')
    expect(history.at(-1)?.url).toBe('https://example.com/3.jpg')
  })

  it('falls back to the cached image outside the desktop shell and retains it in history', async () => {
    selectBingDailyImage(image('20261102', 'https://example.com/2.jpg'))
    const loaded = await loadBingDailyImage()
    expect(loaded?.url).toBe('https://example.com/2.jpg')
    expect(readBingDailyHistory().map(item => item.url)).toEqual(['https://example.com/2.jpg'])
  })
})
