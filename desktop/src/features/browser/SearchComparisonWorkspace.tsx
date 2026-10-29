import { useEffect, useState } from 'react'
import { Button, Spin, Typography } from '../../components/ui'
import { CloseOutlined, SearchOutlined } from '../../components/ui/icons'
import { searchDocuments, type DocumentSearchHit } from '../../api'

export interface ComparisonSource {
  id: string
  kind: 'web' | 'knowledge'
  label: string
  url?: string
}

export function SearchComparisonWorkspace({ query, sources, visibleIds, onShow, onClose }: {
  query: string
  sources: ComparisonSource[]
  visibleIds: string[]
  onShow: (id: string) => void
  onClose: () => void
}) {
  const [localResults, setLocalResults] = useState<DocumentSearchHit[]>([])
  const [localLoading, setLocalLoading] = useState(false)
  const [localError, setLocalError] = useState('')
  const visible = visibleIds.map(id => sources.find(source => source.id === id)).filter(Boolean) as ComparisonSource[]
  const hidden = sources.filter(source => !visibleIds.includes(source.id))

  useEffect(() => {
    if (!sources.some(source => source.kind === 'knowledge')) return
    let current = true
    setLocalLoading(true)
    setLocalError('')
    void searchDocuments(query)
      .then(items => { if (current) setLocalResults(items.slice(0, 20)) })
      .catch(error => { if (current) { setLocalResults([]); setLocalError(error instanceof Error ? error.message : String(error)) } })
      .finally(() => { if (current) setLocalLoading(false) })
    return () => { current = false }
  }, [query, sources])

  return <div className="search-comparison">
    <header className="search-comparison__toolbar">
      <div className="search-comparison__query"><SearchOutlined/><span>{query}</span><small>{visible.length} / {sources.length} 个来源</small></div>
      {hidden.length > 0 && <div className="search-comparison__hidden"><span>隐藏来源</span>{hidden.map(source => <button key={source.id} type="button" onClick={() => onShow(source.id)}>{source.label}</button>)}</div>}
      <Button type="text" icon={<CloseOutlined/>} onClick={onClose}>退出对比</Button>
    </header>
    <div className="search-comparison__grid" style={{ gridTemplateColumns: `repeat(${Math.max(1, visible.length)}, minmax(0, 1fr))` }}>
      {visible.map(source => <section key={source.id} className="search-comparison__pane">
        <div className="search-comparison__pane-title"><strong>{source.label}</strong><span>{source.kind === 'knowledge' ? '本地索引' : '网页搜索'}</span></div>
        <div className="search-comparison__pane-body" data-comparison-view={source.id}>
          {source.kind === 'knowledge' && <div className="search-comparison__local">
            {localLoading ? <div className="search-comparison__empty"><Spin size="small"/>正在检索本地知识库…</div> : localError ? <div className="search-comparison__empty is-error">本地检索失败：{localError}</div> : localResults.length === 0 ? <div className="search-comparison__empty">没有找到包含“{query}”的本地内容</div> : localResults.map(item => <article key={item.id}>
              <Typography.Text strong>{item.title}</Typography.Text>
              <Typography.Paragraph type="secondary">{item.summary || item.markdown?.slice(0, 140) || item.url}</Typography.Paragraph>
            </article>)}
          </div>}
        </div>
      </section>)}
    </div>
  </div>
}
