import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Input, Modal, Tag, Typography, type InputRef } from '../../components/ui'
import {
  ClockCircleOutlined,
  FileTextOutlined,
  GlobalOutlined,
  SearchOutlined,
  StarOutlined,
  ThunderboltOutlined,
} from '../../components/ui/icons'
import type { BrowserTab } from '../../types'
import type { HistoryEntry } from '../history/dedupeHistory'
import type { BookmarkRecord } from '../../services/bookmarks'
import { searchDocuments } from '../../api'
import {
  groupCommandItems,
  nextCommandMode,
  parseCommandQuery,
  type CommandItem,
  type CommandKind,
  type CommandMode,
  type CommandSection,
} from './commandModel'

const MODE_LABEL: Record<CommandMode, string> = {
  all: '全部',
  ask: '问 AI',
  tabs: '标签页',
  bookmarks: '收藏',
  history: '历史',
  knowledge: '知识库',
  actions: '动作',
}

const KIND_ICON: Record<CommandKind, ReactNode> = {
  tab: <GlobalOutlined />,
  history: <ClockCircleOutlined />,
  bookmark: <StarOutlined />,
  document: <FileTextOutlined />,
  action: <ThunderboltOutlined />,
}

export interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  tabs: BrowserTab[]
  activeId: string
  history: HistoryEntry[]
  bookmarks: BookmarkRecord[]
  onActivateTab: (id: string) => void
  onCloseTab: (id: string) => void
  onNavigate: (url: string) => void
  onAskAi: (question: string) => void
  onNewTab: () => void
  onSavePage: () => void
  onBookmarkPage: () => void
  onToggleAi: () => void
  onToggleNotes: () => void
  onBulkSummary: () => void
  onSaveWorkspace: () => void
}

/**
 * Unified command bar: tabs, history, bookmarks, local knowledge and browser
 * actions in one input. `Tab` cycles the provider, prefixes narrow it
 * explicitly, and everything is reachable without leaving the keyboard.
 */
export function CommandPalette({
  open,
  onClose,
  tabs,
  activeId,
  history,
  bookmarks,
  onActivateTab,
  onCloseTab,
  onNavigate,
  onAskAi,
  onNewTab,
  onSavePage,
  onBookmarkPage,
  onToggleAi,
  onToggleNotes,
  onBulkSummary,
  onSaveWorkspace,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<CommandMode>('all')
  const [highlight, setHighlight] = useState(0)
  const [documents, setDocuments] = useState<CommandItem[]>([])
  const inputRef = useRef<InputRef | null>(null)

  const parsed = useMemo(() => parseCommandQuery(query), [query])
  const effectiveMode: CommandMode = mode === 'all' ? parsed.mode : mode
  const effectiveQuery = mode === 'all' ? parsed.query : query.trim()

  useEffect(() => {
    if (!open) return
    setQuery('')
    setMode('all')
    setHighlight(0)
    setDocuments([])
    // Focus after the modal has mounted its portal.
    const frame = requestAnimationFrame(() => inputRef.current?.focus({ cursor: 'all' }))
    return () => cancelAnimationFrame(frame)
  }, [open])

  const tabItems = useMemo<CommandItem[]>(() => tabs.map(tab => ({
    id: `tab:${tab.id}`,
    kind: 'tab',
    title: tab.title || tab.url || '新标签页',
    subtitle: tab.url,
    meta: tab.id === activeId ? '当前' : tab.pinned ? '固定' : undefined,
    keywords: tab.private ? '私密' : undefined,
    run: () => onActivateTab(tab.id),
  })), [tabs, activeId, onActivateTab])

  const historyItems = useMemo<CommandItem[]>(() => history.map(entry => ({
    id: `history:${entry.url}`,
    kind: 'history',
    title: entry.title || entry.url,
    subtitle: entry.url,
    run: () => onNavigate(entry.url),
  })), [history, onNavigate])

  const bookmarkItems = useMemo<CommandItem[]>(() => bookmarks.map(bookmark => ({
    id: `bookmark:${bookmark.id}`,
    kind: 'bookmark',
    title: bookmark.title || bookmark.url,
    subtitle: bookmark.url,
    meta: bookmark.folder || undefined,
    keywords: bookmark.note || undefined,
    run: () => onNavigate(bookmark.url),
  })), [bookmarks, onNavigate])

  const actionItems = useMemo<CommandItem[]>(() => [
    { id: 'action:new-tab', kind: 'action', title: '新建标签页', shortcut: 'Ctrl + T', keywords: 'new tab', run: onNewTab },
    { id: 'action:close-tab', kind: 'action', title: '关闭当前标签页', shortcut: 'Ctrl + W', keywords: 'close tab', run: () => onCloseTab(activeId) },
    { id: 'action:save-page', kind: 'action', title: '保存当前页到知识库', keywords: 'save markdown', run: onSavePage },
    { id: 'action:bookmark', kind: 'action', title: '收藏当前页', shortcut: 'Ctrl + D', keywords: 'bookmark', run: onBookmarkPage },
    { id: 'action:ai', kind: 'action', title: '打开 AI 助手', keywords: 'assistant', run: onToggleAi },
    { id: 'action:notes', kind: 'action', title: '网页笔记面板', shortcut: 'Ctrl + Shift + N', keywords: 'notes', run: onToggleNotes },
    { id: 'action:bulk-summary', kind: 'action', title: '多链接 AI 摘要', shortcut: 'Ctrl + Shift + S', keywords: 'bulk summary', run: onBulkSummary },
    { id: 'action:workspace', kind: 'action', title: '保存当前标签为工作区', shortcut: 'Ctrl + Shift + W', keywords: 'workspace', run: onSaveWorkspace },
  ], [activeId, onNewTab, onCloseTab, onSavePage, onBookmarkPage, onToggleAi, onToggleNotes, onBulkSummary, onSaveWorkspace])

  useEffect(() => {
    if (!open) return
    const q = effectiveQuery.trim()
    const wantsDocuments = effectiveMode === 'knowledge' || (effectiveMode === 'all' && q.length >= 2)
    if (!wantsDocuments || q.length === 0) {
      setDocuments([])
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      void searchDocuments(q)
        .then(hits => {
          if (cancelled) return
          setDocuments(hits.slice(0, 6).map(hit => ({
            id: `document:${hit.id}`,
            kind: 'document' as const,
            title: hit.title || hit.url,
            subtitle: hit.url,
            meta: hit.wordCount > 0 ? `${hit.wordCount} 字` : undefined,
            run: () => onNavigate(hit.url),
          })))
        })
        .catch(() => { if (!cancelled) setDocuments([]) })
    }, 160)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [open, effectiveMode, effectiveQuery, onNavigate])

  const askItem: CommandItem | null = effectiveMode === 'ask' && effectiveQuery
    ? {
        id: 'ask',
        kind: 'action',
        title: `问 AI：${effectiveQuery}`,
        subtitle: '在 AI 助手中继续追问',
        run: () => onAskAi(effectiveQuery),
      }
    : null

  const items = [...tabItems, ...historyItems, ...bookmarkItems, ...actionItems, ...documents]
  const sections: CommandSection[] = askItem
    ? [{ kind: 'action', label: 'AI', items: [askItem] }]
    : groupCommandItems(items, effectiveMode, effectiveQuery)
  const rows = sections.flatMap(section => section.items)
  const activeIndex = Math.min(highlight, Math.max(rows.length - 1, 0))
  const current = rows[activeIndex]

  useEffect(() => {
    if (!open) return
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setHighlight(value => Math.min(value + 1, Math.max(rows.length - 1, 0)))
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setHighlight(value => Math.max(value - 1, 0))
      } else if (event.key === 'Enter') {
        if (!current) return
        event.preventDefault()
        current.run()
        onClose()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      } else if (event.key === 'Tab') {
        event.preventDefault()
        setMode(value => nextCommandMode(value === 'all' ? effectiveMode : value, event.shiftKey ? -1 : 1))
        setQuery(effectiveQuery)
        setHighlight(0)
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [open, rows.length, current, onClose, effectiveMode, effectiveQuery])

  return <Modal
    open={open}
    footer={null}
    closable={false}
    destroyOnHidden
    width={640}
    onCancel={onClose}
    styles={{ body: { padding: 0 } }}
    title={null}
  >
    <div className="tab-search-palette command-palette">
      <Input
        ref={inputRef}
        value={query}
        onChange={event => { setQuery(event.target.value); setHighlight(0) }}
        placeholder="搜索标签、历史、收藏、知识库，或输入 @ / ? > 切换范围"
        size="large"
        prefix={<SearchOutlined />}
        suffix={<span className="command-palette__mode">{MODE_LABEL[effectiveMode]} · Tab 切换</span>}
      />
      <div className="tab-search-palette__list">
        {rows.length === 0
          ? <div className="tab-search-palette__empty">没有匹配项</div>
          : sections.map(section => <section key={section.kind} className="command-palette__section">
              <header>{section.label}</header>
              {section.items.map(item => {
                const index = rows.indexOf(item)
                return <button
                  key={item.id}
                  type="button"
                  className={`command-row${index === activeIndex ? ' is-active' : ''}`}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => { item.run(); onClose() }}
                >
                  <span className="command-row__icon">{KIND_ICON[item.kind]}</span>
                  <span className="command-row__text">
                    <span className="command-row__title">{item.title}</span>
                    {item.subtitle && <span className="command-row__sub">{item.subtitle}</span>}
                  </span>
                  {item.meta && <Tag>{item.meta}</Tag>}
                  {item.shortcut && <kbd>{item.shortcut}</kbd>}
                </button>
              })}
            </section>)}
      </div>
      <Typography.Text type="secondary" className="tab-search-palette__hint">
        ↑↓ 选择 · Enter 执行 · Tab 切换范围 · Esc 关闭
      </Typography.Text>
    </div>
  </Modal>
}
