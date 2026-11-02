import { t } from '../../i18n'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button, Input, List, Modal, Popconfirm, Typography, type InputRef } from '../../components/ui'
import { DeleteOutlined, GlobalOutlined } from '../../components/ui/icons'
import type { HistoryEntry } from './dedupeHistory'
import { searchHistory, type HistorySearchResult } from './historySearchIndex'

export interface HistorySearchPaletteProps {
  open: boolean
  history: HistoryEntry[]
  onClose: () => void
  onOpen: (entry: HistoryEntry) => void
  onRemove: (entry: HistoryEntry) => void
  onClear: () => void
}

const RELATIVE = typeof Intl !== 'undefined' ? new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' }) : null

function formatVisited(visitedAt: number, now = Date.now()): string {
  if (!RELATIVE) return new Date(visitedAt).toLocaleString('zh-CN')
  const delta = visitedAt - now
  const abs = Math.abs(delta)
  if (abs < 60_000) return RELATIVE.format(Math.round(delta / 1000), 'second')
  if (abs < 3_600_000) return RELATIVE.format(Math.round(delta / 60_000), 'minute')
  if (abs < 86_400_000) return RELATIVE.format(Math.round(delta / 3_600_000), 'hour')
  return RELATIVE.format(Math.round(delta / 86_400_000), 'day')
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

/**
 * Command-palette style modal for browsing / searching / deleting history
 * entries. Keyboard-driven: arrows move highlight, Enter opens the current
 * row, Delete removes it, Esc dismisses.
 */
export function HistorySearchPalette({ open, history, onClose, onOpen, onRemove, onClear }: HistorySearchPaletteProps) {
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const inputRef = useRef<any>(null)

  const rows = useMemo<HistorySearchResult[]>(() => searchHistory(query, history), [query, history])
  const current = rows[Math.min(highlight, Math.max(0, rows.length - 1))]

  useEffect(() => {
    if (!open) { setQuery(''); setHighlight(0); return }
    requestAnimationFrame(() => inputRef.current?.focus({ cursor: 'all' }))
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown') { event.preventDefault(); setHighlight(h => Math.min(h + 1, Math.max(0, rows.length - 1))) }
      else if (event.key === 'ArrowUp') { event.preventDefault(); setHighlight(h => Math.max(0, h - 1)) }
      else if (event.key === 'Enter' && current) { event.preventDefault(); onOpen(current); onClose() }
      else if (event.key === 'Delete' && current) { event.preventDefault(); onRemove(current); setHighlight(h => Math.max(0, Math.min(h, rows.length - 2))) }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [open, rows, current, onOpen, onClose, onRemove])

  return <Modal
    open={open}
    footer={null}
    closable={false}
    destroyOnHidden
    width={760}
    className="history-search-modal"
    onCancel={onClose}
    styles={{ body: { padding: 0 } }}
    title={null}
  >
    <div className="tab-search-palette history-search-palette">
      <div className="history-search-palette__toolbar">
        <Input
          ref={inputRef}
          value={query}
          onChange={event => { setQuery(event.target.value); setHighlight(0) }}
          placeholder={t("\u641C\u7D22\u5386\u53F2\u8BB0\u5F55\uFF08\u6807\u9898\u6216\u7F51\u5740\uFF09")}
          size="large"
          prefix={<GlobalOutlined />}
          suffix={<Typography.Text type="secondary">{t("\u2191\u2193 \u9009\u62E9 \xB7 Enter \u6253\u5F00 \xB7 Del \u5220\u9664")}</Typography.Text>}
        />
        <Popconfirm title={t("\u6E05\u7A7A\u5168\u90E8\u5386\u53F2\u8BB0\u5F55\uFF1F")}okText={t("\u6E05\u7A7A")}cancelText={t("\u53D6\u6D88")}okButtonProps={{danger:true}}onConfirm={()=>{onClear();onClose()}}>
          <Button danger>{t("\u5168\u90E8\u6E05\u7A7A")}</Button>
        </Popconfirm>
      </div>
      <div className="tab-search-palette__list">
        {rows.length === 0
          ? <div className="tab-search-palette__empty">{t("\u6CA1\u6709\u5339\u914D\u7684\u5386\u53F2\u8BB0\u5F55")}</div>
          : <List
              dataSource={rows}
              size="small"
              renderItem={(row, index) => <HistoryRow item={row} active={highlight === index} onHover={() => setHighlight(index)} onOpen={() => { onOpen(row); onClose() }} onRemove={() => onRemove(row)} />}
            />}
        {rows.length > 0 && current && <Typography.Text type="secondary" className="tab-search-palette__hint">{t("\u663E\u793A")} 
             {rows.length} / {history.length} {t("\u6761\u5386\u53F2")} 
        </Typography.Text>}
      </div>
    </div>
  </Modal>
}

interface HistoryRowProps {
  item: HistorySearchResult
  active: boolean
  onHover: () => void
  onOpen: () => void
  onRemove: () => void
}

function HistoryRow({ item, active, onHover, onOpen, onRemove }: HistoryRowProps) {
  return <List.Item
    className={`tab-search-row${active ? ' is-active' : ''}`}
    onMouseEnter={onHover}
    onClick={onOpen}
    actions={[<Button key="remove" type="text" danger icon={<DeleteOutlined />} aria-label={t("\u4ECE\u5386\u53F2\u4E2D\u5220\u9664")}onClick={event=>{event.stopPropagation();onRemove()}}/>]}
  >
    <List.Item.Meta
      avatar={<GlobalOutlined />}
      title={<div className="history-search-row__title"><span>{highlight(item.title || item.url, item.titleHighlights)}</span><Typography.Text type="secondary">{formatVisited(item.visitedAt)}</Typography.Text></div>}
      description={<div className="history-search-row__url" title={item.url}>{highlight(item.url, item.urlHighlights)}</div>}
    />
  </List.Item>
}