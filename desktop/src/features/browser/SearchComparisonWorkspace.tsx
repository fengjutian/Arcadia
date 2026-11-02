import { t } from '../../i18n'
import { useEffect, useState, type FormEvent } from 'react'
import { Button, Spin, Typography } from '../../components/ui'
import { CloseOutlined, SearchOutlined } from '../../components/ui/icons'
import { searchDocuments, type DocumentSearchHit } from '../../api'
import { AssistantPage } from '../../pages/assistant/AssistantPage'

export interface ComparisonSource {
  id: string
  kind: 'web' | 'knowledge' | 'ai'
  label: string
  engineId?: string
  url?: string
}

export function SearchComparisonWorkspace({ query, sources, visibleIds, onShow, onSearch, onClose }: {
  query: string
  sources: ComparisonSource[]
  visibleIds: string[]
  onShow: (id: string) => void
  onSearch: (query: string) => void
  onClose: () => void
}) {
  const [draftQuery, setDraftQuery] = useState(query)
  const [localResults, setLocalResults] = useState<DocumentSearchHit[]>([])
  const [localLoading, setLocalLoading] = useState(false)
  const [localError, setLocalError] = useState('')
  const visible = visibleIds.map(id => sources.find(source => source.id === id)).filter(Boolean) as ComparisonSource[]
  const hidden = sources.filter(source => !visibleIds.includes(source.id))

  useEffect(() => setDraftQuery(query), [query])

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextQuery = draftQuery.trim()
    if (nextQuery && nextQuery !== query) onSearch(nextQuery)
  }

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
      <form className="search-comparison__search" onSubmit={submitSearch}>
        <SearchOutlined/>
        <input aria-label={t("\u91CD\u65B0\u641C\u7D22")}value={draftQuery}onChange={event=>setDraftQuery(event.target.value)}placeholder={t("\u8F93\u5165\u5173\u952E\u8BCD\u91CD\u65B0\u641C\u7D22")}/>
        <span className="search-comparison__source-count">{visible.length} / {sources.length} {t("\u4E2A\u6765\u6E90")}</span>
        <button className="search-comparison__submit" type="submit" disabled={!draftQuery.trim() || draftQuery.trim() === query}>{t("\u641C\u7D22")}</button>
      </form>
      {hidden.length > 0 && <div className="search-comparison__hidden"><span>{t("\u6DFB\u52A0\u6765\u6E90")}</span>{hidden.map(source=><button key={source.id}type="button"onClick={()=>onShow(source.id)}>{source.label}</button>)}</div>}
      <Button className="search-comparison__close" type="text" icon={<CloseOutlined/>} onClick={onClose}>{t("\u9000\u51FA\u5BF9\u6BD4")}</Button>
    </header>
    <div className="search-comparison__grid" style={{ gridTemplateColumns: `repeat(${Math.max(1, visible.length)}, minmax(0, 1fr))` }}>
      {visible.map(source => <section key={source.id} className={`search-comparison__pane${source.kind === 'ai' ? ' is-ai' : ''}`}>
        <div className="search-comparison__pane-title"><strong>{source.label}</strong><span>{source.kind === 'knowledge' ?t("\u672C\u5730\u7D22\u5F15"):source.kind==='ai'?t("AI \u5BF9\u8BDD"):t("\u7F51\u9875\u641C\u7D22")}</span></div>
        <div className="search-comparison__pane-body" data-comparison-view={source.id}>
          {source.kind === 'knowledge' && <div className="search-comparison__local">
            {localLoading ? <div className="search-comparison__empty"><Spin size="small"/>{t("\u6B63\u5728\u68C0\u7D22\u672C\u5730\u77E5\u8BC6\u5E93\u2026")}</div>:localError?<div className="search-comparison__empty is-error">{t("\u672C\u5730\u68C0\u7D22\u5931\u8D25\uFF1A")}{localError}</div>:localResults.length===0?<div className="search-comparison__empty">{t("\u6CA1\u6709\u627E\u5230\u5305\u542B\u201C")}{query}{t("\u201D\u7684\u672C\u5730\u5185\u5BB9")}</div>:localResults.map(item=><article key={item.id}>
              <Typography.Text strong>{item.title}</Typography.Text>
              <Typography.Paragraph type="secondary">{item.summary || item.markdown?.slice(0, 140) || item.url}</Typography.Paragraph>
            </article>)}
          </div>}
          {source.kind === 'ai' && <div className="search-comparison__ai"><AssistantPage key={query} initialQuestion={query} autoSubmit embedded sessionNamespace={`comparison:${query}`}/></div>}
        </div>
      </section>)}
    </div>
  </div>
}