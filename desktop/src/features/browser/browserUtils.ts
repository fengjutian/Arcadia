/**
 * Pure helpers for tab visual hints and the new-tab quick-access grid.
 * Extracted from BrowserPage so the logic can be unit-tested without React.
 */
import type { BrowserTab } from '../../types'

export const TAB_GROUP_PALETTE = ['#a7dfbd', '#9bc6e8', '#dfc0a7', '#c8a7df', '#dfb5b5', '#bce0c6']

export const tabGroupColor = (id: string | null | undefined): string => {
  if (!id) return 'transparent'
  let hash = 0
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return TAB_GROUP_PALETTE[hash % TAB_GROUP_PALETTE.length]
}

export interface QuickSite {
  name: string
  url: string
  initial: string
  color: string
  iconUrl: string
}

export const QUICK_SITES: QuickSite[] = [
  { name: 'GitHub', url: 'https://github.com', initial: 'G', color: '#1f2328', iconUrl: '/icons/quick-sites/github.ico' },
  { name: '掘金', url: 'https://juejin.cn', initial: 'J', color: '#1e80ff', iconUrl: '/icons/quick-sites/juejin.ico' },
  { name: 'MDN', url: 'https://developer.mozilla.org', initial: 'M', color: '#1d2421', iconUrl: '/icons/quick-sites/mdn.ico' },
  { name: 'ChatGPT', url: 'https://chatgpt.com', initial: 'C', color: '#10a37f', iconUrl: '/icons/quick-sites/chatgpt.ico' },
  { name: '知乎', url: 'https://www.zhihu.com', initial: '知', color: '#0084ff', iconUrl: '/icons/quick-sites/zhihu.ico' },
  { name: 'Bilibili', url: 'https://www.bilibili.com', initial: 'B', color: '#fb7299', iconUrl: '/icons/quick-sites/bilibili.ico' },
  { name: 'arXiv', url: 'https://arxiv.org', initial: 'a', color: '#b31b1b', iconUrl: '/icons/quick-sites/arxiv.ico' },
  { name: 'Google Scholar', url: 'https://scholar.google.com', initial: 'S', color: '#4285f4', iconUrl: '/icons/quick-sites/google-scholar.ico' },
  { name: 'Hacker News', url: 'https://news.ycombinator.com', initial: 'H', color: '#ff6600', iconUrl: '/icons/quick-sites/hacker-news.ico' },
  { name: 'Wikipedia', url: 'https://www.wikipedia.org', initial: 'W', color: '#1d2421', iconUrl: '/icons/quick-sites/wikipedia.ico' },
  { name: '百度', url: 'https://www.baidu.com', initial: '百', color: '#2932e1', iconUrl: '/icons/quick-sites/baidu.ico' },
  { name: '微博', url: 'https://weibo.com', initial: '微', color: '#e6162d', iconUrl: '/icons/quick-sites/weibo.ico' },
  { name: '小红书', url: 'https://www.xiaohongshu.com', initial: '红', color: '#ff2442', iconUrl: '/icons/quick-sites/xiaohongshu.ico' },
  { name: '淘宝', url: 'https://www.taobao.com', initial: '淘', color: '#ff5000', iconUrl: '/icons/quick-sites/taobao.ico' },
]

export const newTab = (id: string = crypto.randomUUID()): BrowserTab => ({
  id,
  url: '',
  title: '新标签页',
  loading: false,
  active: true,
  pinned: false,
})
