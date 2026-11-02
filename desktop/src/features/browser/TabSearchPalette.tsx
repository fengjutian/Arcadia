import { translate } from '../../i18n'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Input, List, Modal, Tag, Typography, type InputRef } from '../../components/ui'
import { GlobalOutlined, LockOutlined } from '../../components/ui/icons'
import type { BrowserTab } from '../../types'
import { searchTabs, type TabSearchResult } from './tabSearchIndex'

export interface TabSearchPaletteProps {
  open: boolean
  tabs: BrowserTab[]
  activeId: string
  onClose: () => void
  onPick: (id: string) => void
  onCloseTab: (id: string) => void
}

interface Row extends TabSearchResult {
  tab: BrowserTab
}

/**
 * Command-palette style modal that lets the user fuzzy-search across every open
 * tab and jump to it. Keyboard-driven: arrows to move, Enter to pick, Ctrl+W
 * to close the highlighted tab, Esc to dismiss.
 */
export function TabSearchPalette({ open, tabs, activeId, onClose, onPick, onCloseTab }: TabSearchPaletteProps) {
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const inputRef = useRef<any>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  const rows = useMemo<Row[]>(() => searchTabs(query, tabs).map(          (result


   )                                                                   =>( {...result,tab:tabs.find(t=>t.id===result.id)??({id:result.id,url:result.url,title:result.title,loading:result.loading,active:result.active,pinned:result.pinned}as BrowserTab),})),[query,tabs])
  const current = rows[Math.min(highlight, Math.max(0, rows.length - 1))]

  useEffect(() => {
    if (!open) { setQuery(''); setHighlight(0); return }
    // Focus + select once the modal mounts so typing replaces any stale value.
    requestAnimationFrame(() => inputRef.current?.focus({ cursor: 'all' }))
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown') { event.preventDefault(); setHighlight(h => Math.min(h + 1, Math.max(0, rows.length - 1))) }
      else if (event.key === 'ArrowUp') { event.preventDefault(); setHighlight(h => Math.max(0, h - 1)) }
      else if (event.key === 'Enter' && current) { event.preventDefault(); onPick(current.id); onClose() }
      else if ((event.key === 'w' || event.key === 'W') &&( event.ctrlKey || event.metaKey) && current) {
        event.preventDefault()
        onCloseTab(current.id)
        setHighlight(0)
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [open, rows, current, onPick, onClose, onCloseTab])

  return <Modal
    open={open}
    footer={null}
    closable={false}
    destroyOnHidden
    width={620}
    onCancel={onClose}
    styles={{ body: { padding: 0 } }}
    title={null}
  >
    <div className="tab-search-palette">
      <Input
        ref={inputRef}
        value={query}
        onChange={event => { setQuery(event.target.value); setHighlight(0) }}
        placeholder={translate("\u641C\u7D22\u6807\u7B7E\u9875\uFF08\u6807\u9898\u6216\u7F51\u5740\uFF09")}
        size="large"
        prefix={<GlobalOutlined />}
        suffix={<Typography.Text type="secondary">{translate("\u2191\u2193 \u9009\u62E9 \xB7 Enter \u8DF3\u8F6C \xB7 Ctrl+W \u5173\u95ED")}</Typography.Text>}
      />
      <div className="tab-search-palette__list" ref={listRef}>
        {rows.length === 0
          ? <div className="tab-search-palette__empty">{translate("\u6CA1\u6709\u5339\u914D\u7684\u6807\u7B7E\u9875")}</div>
          : <List
              dataSource={rows}
              renderItem={(row, index) => <ListTabRow item={row} active={highlight === index} onHover={() => setHighlight(index)} onPick={() => { onPick(row.id); onClose() }} />}
            />}
        {rows.length > 0 && current && <Typography.Text type="secondary" className="tab-search-palette__hint">{translate("\u547D\u4E2D")} 
             <strong>{current.title || current.url}</strong>{' · '}{tabs.length} {translate("\u4E2A\u6807\u7B7E")} 
          {activeId === current.id ?translate(" \xB7 \u5F53\u524D\u6D3B\u8DC3"):''}
        </Typography.Text>}
      </div>
    </div>
  </Modal>
}

interface ListTabRowProps {
  item: Row
  active: boolean
  onHover: () => void
  onPick: () => void
}

function ListTabRow({ item, active, onHover, onPick }: ListTabRowProps) {
  return <List.Item
    className={`tab-search-row${active ? ' is-active' : ''}`}
    onMouseEnter={onHover}
    onClick={onPick}
  >
    <List.Item.Meta
      avatar={item.tab.private ? <LockOutlined /> : <GlobalOutlined />}
      title={<>
        {highlight(item.title || item.url, item.titleHighlights)}
        {item.tab.active && <Tag color="blue" style={{ marginLeft: 6 }}>{translate("\u5F53\u524D")}</Tag>}
        {item.tab.pinned && <Tag color="gold" style={{ marginLeft: 6 }}>{translate("\u56FA\u5B9A")}</Tag>}
      </>}
      description={highlight(item.url, item.urlHighlights)}
    />
  </List.Item>
}

function highlight(text: string, spans: ReadonlyArray<[number, number]>): ReactNode {
  if (!spans.length) return text
  const parts: ReactNode[] = []
  let cursor = 0
  for (const [start, end] of spans) {
    if (start > cursor) parts.push(text.slice(cursor, start))
    parts.push(<mark key={`${start}-${end}`}>{text.slice(start, end)}</mark>)
    cursor = end
  }
  if (cursor < text.length) parts.push(text.slice(cursor))
  return <>{parts}</>
}