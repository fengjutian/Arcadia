import { t } from '../../i18n'
import { AutoComplete, Button, Input, message, Modal, Popconfirm, Select, Spin, Tag, Typography, type InputRef } from '../../components/ui'
import { BookOutlined, ClockCircleOutlined, DeleteOutlined, FileTextOutlined, InboxOutlined, SearchOutlined, StarFilled, StarOutlined } from '../../components/ui/icons'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { PageHeader } from '../../shared/components/PageHeader'
import { DocumentDetailDrawer } from '../../features/documents/DocumentDetailDrawer'
import { deleteDocument, deleteReadingSnapshot, searchDocuments, listReadingActivity, getSearchSuggestions, getSession, setSession, type DocumentSearchHit } from '../../api'
import type { ReadingActivity } from '../../types'
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue'
import { renderHighlightedSnippet } from '../../features/search/renderSnippet'
import { X } from 'lucide-react'
import { dedupeSearchResults, matchesAdvancedSearch, parseAdvancedSearch } from '../../features/search/advancedSearch'

type SortKey = 'recent' | 'oldest' | 'starred' | 'relevance'

const SORT_OPTIONS: Array<{ label: string; value: SortKey }> = [
  { label:t("\u6700\u65B0"),value:'recent'},
  { label:t("\u6700\u65E9"),value:'oldest'},
  { label:t("\u6536\u85CF\u4F18\u5148"),value:'starred'},
]

export function SearchPage({ initialQuery = '', onOpenUrl }: { initialQuery?: string; onOpenUrl?: (url: string) => void }) {
  const [messageApi, contextHolder] = message.useMessage()
  const [query, setQuery] = useState(initialQuery)
  const debouncedQuery = useDebouncedValue(query, 250)
  const advancedQuery = useMemo(() => parseAdvancedSearch(debouncedQuery), [debouncedQuery])
  const [documents, setDocuments] = useState<DocumentSearchHit[]>([])
  const [reading, setReading] = useState<ReadingActivity[]>([])
  const [selected, setSelected] = useState<DocumentSearchHit | null>(null)
  const [selectedReading, setSelectedReading] = useState<ReadingActivity | null>(null)
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [tagFilter, setTagFilter] = useState<string[]>([])
  const [starredOnly, setStarredOnly] = useState(false)
  const [includeArchived, setIncludeArchived] = useState(false)
  const [readOnly, setReadOnly] = useState(false)
  const [sort, setSort] = useState<SortKey>(initialQuery.trim() ? 'relevance' : 'recent')
  const [durationMs, setDurationMs] = useState<number | null>(null)
  const [recentQueries, setRecentQueries] = useState<string[]>([])
  const [reloadToken, setReloadToken] = useState(0)
  const [searchSuggestions, setSearchSuggestions] = useState<string[]>([])
  const searchRef = useRef<InputRef>(null)

  useEffect(() => {
    void getSession('search.recent').then(raw => {
      if (!raw) return
      try {
        const parsed = JSON.parse(raw) as string[]
        if (Array.isArray(parsed)) {
          const loaded = parsed.filter(value => typeof value === 'string').slice(0, 10)
          setRecentQueries(previous => Array.from(new Set([...previous, ...loaded])).slice(0, 10))
        }
      } catch { /* ignore corrupt session */ }
    })
  }, [])

  const rememberQuery = useCallback((value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return
    setRecentQueries(prev => {
      const next = [trimmed, ...prev.filter(item => item !== trimmed)].slice(0, 10)
      void setSession('search.recent', JSON.stringify(next))
      return next
    })
  }, [])

  useEffect(() => {
    if (initialQuery && initialQuery !== query) setQuery(initialQuery)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery])

  useEffect(() => {
    let current = true
    setLoading(true)
    const startedAt = performance.now()
    void Promise.all([searchDocuments(advancedQuery.text), listReadingActivity()])
      .then(([items, activity]) => {
        if (!current) return
        setDocuments(items)
        setReading(activity)
        setUnavailable(false)
        setLoadError(null)
        setDurationMs(Math.round(performance.now() - startedAt))
      })
      // The knowledge base lives in this app's own SQLite file, so a rejection
      // here is a real command failure, not a missing network service. Keep the
      // message: it is the only clue the user (or a bug report) gets.
      .catch((error: unknown) => {
        if (!current) return
        const detail = error instanceof Error ? error.message : String(error ?? '')
        console.error(t("[search] \u8BFB\u53D6\u672C\u5730\u77E5\u8BC6\u5E93\u5931\u8D25"),error)
        setDocuments([])
        setReading([])
        setUnavailable(true)
        setLoadError(detail ||t("\u672A\u77E5\u9519\u8BEF"))
      })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [advancedQuery, reloadToken])

  useEffect(() => {
    let current = true
    void getSearchSuggestions(debouncedQuery).then(items => { if (current) setSearchSuggestions(items) }).catch(() => { if (current) setSearchSuggestions([]) })
    return () => { current = false }
  }, [debouncedQuery])

  useEffect(() => {
    if (!debouncedQuery && sort === 'relevance') setSort('recent')
  }, [debouncedQuery, sort])

  const readingByUrl = useMemo(() => new Map(reading.map(item => [item.url, item])), [reading])

  const unsavedReading = useMemo(() => {
    const savedUrls = new Set(documents.map(item => item.url))
    const lower = advancedQuery.text.toLowerCase()
    return reading
      .filter(item => {
        if (savedUrls.has(item.url) || readingStatus(item) === 'seen') return false
        if (!lower) return true
        return [item.title, item.url, item.excerpt ?? '', item.markdown ?? ''].some(field => field.toLowerCase().includes(lower))
      })
      .sort((a, b) => sort === 'oldest' ? a.lastVisitedAt - b.lastVisitedAt : b.lastVisitedAt - a.lastVisitedAt)
  }, [documents, reading, advancedQuery.text, sort])

  const allTags = useMemo(() => {
    const set = new Set<string>()
    documents.forEach(doc => doc.tags.forEach(tag => set.add(tag)))
    return Array.from(set).sort()
  }, [documents])

  const filtered = useMemo(() => {
    return dedupeSearchResults(documents
      .filter(doc => {
        if (starredOnly && !doc.starred) return false
        if (readOnly && readingStatus(readingByUrl.get(doc.url)) === 'seen') return false
        if (!includeArchived && doc.status === 'ARCHIVED') return false
        if (tagFilter.length > 0 && !tagFilter.every(tag => doc.tags.includes(tag))) return false
        if (!matchesAdvancedSearch(doc, advancedQuery)) return false
        // The backend may return Pinyin, initials, synonym and semantic
        // matches that do not literally contain the typed query. Do not apply
        // a second client-side substring filter or those results disappear.
        return true
      }))
      .sort((a, b) => {
        if (sort === 'starred') return Number(b.starred) - Number(a.starred) || b.createdAt.localeCompare(a.createdAt)
        if (sort === 'oldest') return a.createdAt.localeCompare(b.createdAt)
        // Relevance order already includes exact-field priority, BM25, stars
        // and recency on the Rust side. Preserve it instead of reducing the
        // order back to the raw BM25 number in the renderer.
        if (sort === 'relevance') return 0
        return (readingByUrl.get(b.url)?.lastVisitedAt ?? Date.parse(b.createdAt) / 1000) -( readingByUrl.get(a.url)?.lastVisitedAt ?? Date.parse(a.createdAt) / 1000)
      })
  }, [documents, advancedQuery, starredOnly, includeArchived, tagFilter, sort, readOnly, readingByUrl])

  const terms = useMemo(() => debouncedQuery.trim().split(/\s+/).filter(Boolean), [debouncedQuery])
  const hasQuery = debouncedQuery.trim().length > 0
  const hasFilters = tagFilter.length > 0 || starredOnly || includeArchived || readOnly
  const total = filtered.length + unsavedReading.length
  const showEmpty = !loading && total === 0

  const sortOptions = useMemo(() => hasQuery ? [{ label:t("\u76F8\u5173\u5EA6"),value:'relevance'as const},...SORT_OPTIONS]:SORT_OPTIONS,[hasQuery])

  const resetFilters = useCallback(() => {
    setTagFilter([])
    setStarredOnly(false)
    setReadOnly(false)
    setIncludeArchived(false)
  }, [])

  const openDocument = useCallback((item: DocumentSearchHit) => {
    if (debouncedQuery.trim()) rememberQuery(debouncedQuery)
    setSelected(item)
  }, [debouncedQuery, rememberQuery])

  const openReading = useCallback((item: ReadingActivity) => {
    if (debouncedQuery.trim()) rememberQuery(debouncedQuery)
    if (item.markdown) setSelectedReading(item)
    else onOpenUrl?.(item.url)
  }, [debouncedQuery, rememberQuery, onOpenUrl])

  const removeDocument = useCallback(async (item: DocumentSearchHit) => {
    try {
      await deleteDocument(item.id)
      setDocuments(items => items.filter(document => document.id !== item.id))
      if (selected?.id === item.id) setSelected(null)
      messageApi.success(t("\u5DF2\u5220\u9664"))
    } catch {
      messageApi.error(t("\u5220\u9664\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5"))
    }
  }, [messageApi, selected?.id])

  return <section className="page search-page">
    {contextHolder}
    <PageHeader
      eyebrow="LOCAL SEARCH"
      title={t("\u627E\u56DE\u4F60\u8BFB\u8FC7\u7684\u5185\u5BB9")}
      description={t("\u641C\u7D22\u4FDD\u5B58\u5728\u672C\u5730 SQLite \u4E2D\u7684\u771F\u5B9E\u7F51\u9875\u5185\u5BB9\u3002")}
      extra={<div className={`search-status${loading ? ' is-loading' : ''}${unavailable ? ' is-error' : ''}`} aria-live="polite">
        <span className="search-status__dot" aria-hidden="true"/>
        {loading
          ? <span>{t("\u6B63\u5728\u68C0\u7D22\u672C\u5730\u7D22\u5F15\u2026")}</span>
          : unavailable
            ? <span>{t("\u672C\u5730\u6570\u636E\u5E93\u4E0D\u53EF\u7528")}</span>
            : <span>{t("\u627E\u5230")} <b>{total}</b> {t("\u6761\u5185\u5BB9 \xB7")} <span className="search-status__latency">{durationMs??'—'} ms</span></span>}
      </div>}
    />

    <div className="search-page__body">
      <div className="search-console">
        <AutoComplete options={searchSuggestions.map(         (value                  )=>({value,label:value}))}value={query}onChange={setQuery}onSelect={value=>{setQuery(value);rememberQuery(value)}}>
        <Input
          ref={searchRef}
          size="large"
          className="search-console__input"
          prefix={<SearchOutlined/>}
          value={query}
          onChange={event => setQuery(event.target.value)}
          onPressEnter={() => rememberQuery(query)}
          placeholder={t("\u641C\u7D22\u6807\u9898\u3001\u6B63\u6587\u6216\u6807\u7B7E")}
          allowClear
          autoFocus
          aria-label={t("\u641C\u7D22\u6807\u9898\u3001\u6B63\u6587\u6216\u6807\u7B7E")}
        />
        </AutoComplete>

        {recentQueries.length > 0 && !query &&(
          <div className="search-recent">
            <span className="search-recent__label"><ClockCircleOutlined/> {t("\u6700\u8FD1\u641C\u7D22")}</span>
            {recentQueries.slice(0, 6).map(        (item

            )                                   =>(<button key={item}type="button"className="search-recent__item"onClick={()=>{setQuery(item);searchRef.current?.focus({cursor:'end'})}}>{item}</button>))}
          </div>)
         }

        <div className="search-console__footer">
          <div className="search-filters" role="group" aria-label={t("\u7B5B\u9009\u641C\u7D22\u7ED3\u679C")}>
            {allTags.length > 0 && <Select<string>
              mode="multiple"
              className="search-tag-filter"
              ariaLabel={t("\u6309\u6807\u7B7E\u7B5B\u9009")}
              options={allTags.map(       (tag                       )=>({label:tag,value:tag}))}
              placeholder={t("\u5168\u90E8\u6807\u7B7E")}
              value={tagFilter}
              onChange={value => setTagFilter(Array.isArray(value) ? value : [])}
            />}
            <button type="button" className={`search-filter${starredOnly ? ' is-active' : ''}`} aria-pressed={starredOnly} onClick={() => setStarredOnly(value => !value)} title={t("\u53EA\u663E\u793A\u5DF2\u6536\u85CF\u7684\u5185\u5BB9")}>
              <StarOutlined/> {t("\u4EC5\u6536\u85CF")} 
            </button>
            <button type="button" className={`search-filter${readOnly ? ' is-active' : ''}`} aria-pressed={readOnly} onClick={() => setReadOnly(value => !value)} title={t("\u53EA\u663E\u793A\u8FBE\u5230\u9605\u8BFB\u65F6\u957F\u6216\u6EDA\u52A8\u6DF1\u5EA6\u7684\u5185\u5BB9")}>
              <BookOutlined/> {t("\u786E\u5B9E\u8BFB\u8FC7")} 
            </button>
            <button type="button" className={`search-filter${includeArchived ? ' is-active' : ''}`} aria-pressed={includeArchived} onClick={() => setIncludeArchived(value => !value)} title={t("\u540C\u65F6\u663E\u793A\u5DF2\u5F52\u6863\u7684\u5185\u5BB9")}>
              <InboxOutlined/> {t("\u542B\u5F52\u6863")} 
            </button>
            {hasFilters && <button type="button" className="search-filters__reset" onClick={resetFilters}><X size={12}/> {t("\u6E05\u9664\u7B5B\u9009")}</button>}
          </div>
          <div className="search-sort">
            <span className="search-sort__label">{t("\u6392\u5E8F")}</span>
            <Select<SortKey> className="search-sort__select" ariaLabel={t("\u6392\u5E8F\u65B9\u5F0F")}options={sortOptions}value={sort}onChange={value=>setSort(value)}/>
          </div>
        </div>
      </div>

      {loading && total === 0 && <div className="search-loading" aria-live="polite"><Spin size="small"/><span>{t("\u6B63\u5728\u68C0\u7D22\u672C\u5730\u7D22\u5F15\u2026")}</span></div>}

      {showEmpty &&( unavailable
        ? <SearchEmpty
            title={t("\u672C\u5730\u6570\u636E\u5E93\u6682\u65F6\u4E0D\u53EF\u7528")}
            description={t("\u8BFB\u53D6\u672C\u673A knowledge.db \u5931\u8D25\u3002\u5185\u5BB9\u90FD\u5728\u8FD9\u53F0\u673A\u5668\u4E0A\uFF0C\u4E0D\u9700\u8981\u8FDE\u63A5\u6216\u542F\u52A8\u4EFB\u4F55\u670D\u52A1\uFF1B\u53EF\u4EE5\u5148\u91CD\u8BD5\uFF0C\u82E5\u53CD\u590D\u5931\u8D25\u8BF7\u9644\u4E0A\u4E0B\u65B9\u7684\u9519\u8BEF\u4FE1\u606F\u3002")}
            detail={loadError}
            action={<Button onClick={() => setReloadToken(value => value + 1)}>{t("\u91CD\u8BD5")}</Button>}
          />
        : <SearchEmpty
            title={hasQuery || hasFilters ?t("\u6CA1\u6709\u627E\u5230\u5339\u914D\u7684\u5185\u5BB9"):t("\u8FD8\u6CA1\u6709\u53EF\u641C\u7D22\u7684\u5185\u5BB9")}
            description={hasQuery || hasFilters ?t("\u8BD5\u8BD5\u66F4\u77ED\u7684\u5173\u952E\u8BCD\uFF0C\u6216\u51CF\u5C11\u7B5B\u9009\u6761\u4EF6\u3002"):t("\u6D4F\u89C8\u7F51\u9875\u540E\uFF0C\u4FDD\u5B58\u7684\u6587\u7AE0\u548C\u9605\u8BFB\u8BB0\u5F55\u4F1A\u51FA\u73B0\u5728\u8FD9\u91CC\u3002")}
            action={hasQuery || hasFilters ? <>
              {hasQuery && <Button onClick={() => { setQuery(''); searchRef.current?.focus() }}>{t("\u6E05\u7A7A\u641C\u7D22")}</Button>}
              {hasFilters && <Button type="primary" onClick={resetFilters}>{t("\u6E05\u9664\u7B5B\u9009")}</Button>}
            </> : undefined}
          />)}

      {!showEmpty &&(
        <>
          {filtered.length > 0 && <section className="search-section">
            <SectionHeading title={t("\u5DF2\u4FDD\u5B58")}count={filtered.length}hint={t("\u5DF2\u5199\u5165\u672C\u5730\u77E5\u8BC6\u5E93")}/>
            <div className="result-grid result-grid--saved">
              {filtered.map(item => {
                const activity = readingByUrl.get(item.url)
                const titleSnippet = item.titleSnippet && terms.length > 0 ? renderHighlightedSnippet(item.titleSnippet) : null
                const snippetSnippet = item.markdownSnippet || item.summarySnippet
                const snippetNode = snippetSnippet ? renderHighlightedSnippet(snippetSnippet) : null
                return <ResultCard
                  key={item.id}
                  title={titleSnippet ?? <Highlight text={item.title || item.url} terms={terms}/>}
                  titleText={item.title || item.url}
                  url={item.url}
                  snippet={snippetNode ?? <Highlight text={extractSummary(item.summary, item.markdown)} terms={terms}/>}
                  tags={item.tags}
                  activeTags={tagFilter}
                  starred={item.starred}
                  activity={activity}
                  savedAt={item.createdAt}
                  wordCount={item.wordCount}
                  matchReason={item.matchReason}
                  onOpen={() => openDocument(item)}
                  onDelete={() => removeDocument(item)}
                />
              })}
            </div>
          </section>}

          {unsavedReading.length > 0 && <section className="search-section search-section--reading">
            <SectionHeading title={t("\u8BFB\u8FC7\u4F46\u672A\u4FDD\u5B58")}count={unsavedReading.length}hint={t("\u4FDD\u7559\u4E86\u9605\u8BFB\u8F68\u8FF9\uFF0C\u5C1A\u672A\u5199\u5165\u77E5\u8BC6\u5E93")}/>
            <div className="result-grid">
              {unsavedReading.map(item => {
                const summary = extractSummary(item.excerpt, item.markdown, 240)
                return <ResultCard
                  key={item.url}
                  title={<Highlight text={item.title || item.url} terms={terms}/>}
                  titleText={item.title || item.url}
                  url={item.url}
                  snippet={summary ? <Highlight text={summary} terms={terms}/> : <span className="result-card__url">{item.url}</span>}
                  snippetIsUrl={!summary}
                  activity={item}
                  availability={item.markdown ? 'snapshot' : 'visit'}
                  onOpen={() => openReading(item)}
                  actionLabel={item.markdown ?t("\u67E5\u770B\u9605\u8BFB\u5FEB\u7167\uFF1A{value0}",{value0:item.title||item.url}):t("\u91CD\u65B0\u6253\u5F00\uFF1A{value0}",{value0:item.title||item.url})}
                />
              })}
            </div>
          </section>}
        </>)
       }
    </div>

    <Modal
      open={selectedReading !== null}
      title={selectedReading?.title ||t("\u9605\u8BFB\u5FEB\u7167")}
      width="min(900px, 90vw)"
      onCancel={() => setSelectedReading(null)}
      destroyOnHidden
      footer={<div className="snapshot-actions">
        <Button danger onClick={() => {
          const url = selectedReading?.url
          if (!url) return
          void deleteReadingSnapshot(url).then(() => {
            setReading(items => items.map(item => item.url === url ? { ...item, excerpt: undefined, markdown: undefined, capturedAt: undefined } : item))
            setSelectedReading(null)
          })
        }}>{t("\u5220\u9664\u5FEB\u7167")}</Button>
        <Button onClick={() => setSelectedReading(null)}>{t("\u5173\u95ED")}</Button>
        <Button type="primary" onClick={() => {
          const url = selectedReading?.url
          setSelectedReading(null)
          if (url) onOpenUrl?.(url)
        }}>{t("\u91CD\u65B0\u6253\u5F00\u539F\u7F51\u9875")}</Button>
      </div>}
    >
      {selectedReading && <>
        <Typography.Paragraph type="secondary" copyable>{selectedReading.url}</Typography.Paragraph>
        <Typography.Paragraph className="snapshot-body">{selectedReading.markdown}</Typography.Paragraph>
      </>}
    </Modal>
    <DocumentDetailDrawer document={selected} onClose={() => setSelected(null)} onDeleted={id => setDocuments(items => items.filter(item => item.id !== id))}/>
  </section>
}

function SectionHeading({ title, count, hint }: { title: string; count: number; hint: string }) {
  return <div className="search-section__head">
    <h2>{title}<span className="search-section__count">{count}</span></h2>
    <p>{hint}</p>
  </div>
}

function SearchEmpty({ title, description, detail, action }: { title: string; description: string; detail?: string | null; action?: ReactNode }) {
  return <div className="search-empty-panel">
    <span className="search-empty-panel__icon"><SearchOutlined/></span>
    <h2>{title}</h2>
    <p>{description}</p>
    {detail && <code className="search-empty-panel__detail" title={detail}>{detail}</code>}
    {action && <div className="search-empty-panel__actions">{action}</div>}
  </div>
}

interface ResultCardProps {
  title: ReactNode
  titleText: string
  url: string
  snippet: ReactNode
  snippetIsUrl?: boolean
  tags?: string[]
  activeTags?: string[]
  starred?: boolean
  activity?: ReadingActivity
  savedAt?: string
  wordCount?: number
  matchReason?: string
  availability?: 'snapshot' | 'visit'
  actionLabel?: string
  onOpen: () => void
  onDelete?: () => void | Promise<void>
}

function ResultCard({ title, titleText, url, snippet, snippetIsUrl, tags = [], activeTags = [], starred, activity, savedAt, wordCount, matchReason, availability, actionLabel, onOpen, onDelete }: ResultCardProps) {
  const domain = domainOf(url)
  const status = activity ? readingStatus(activity) : null
  const scroll = activity ? Math.min(100, Math.max(0, Math.round(activity.maxScrollDepth * 100))) : 0

  return <article
    className="result-card"
    role="button"
    tabIndex={0}
    aria-label={`${actionLabel ??t("\u6253\u5F00\uFF1A{value0}",{value0:titleText})}${starred?t("\uFF0C\u5DF2\u6536\u85CF"):''}`}
    onClick={onOpen}
    onKeyDown={event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        onOpen()
      }
    }}
  >
    <div className="result-card__top">
      <span className={`site-badge site-badge--${domainTone(domain)}`} aria-hidden="true">{domainInitial(domain)}</span>
      <span className="site-domain" title={url}>{domain}</span>
      <span className="result-card__top-actions">
        {starred && <StarFilled className="result-card__star" role="img" aria-label={t("\u5DF2\u6536\u85CF")}/>}
        {onDelete && <Popconfirm
          title={t("\u5220\u9664\u8FD9\u7BC7\u5DF2\u4FDD\u5B58\u7684\u5185\u5BB9\uFF1F")}
          description={t("\u8BE5\u64CD\u4F5C\u4F1A\u540C\u65F6\u5220\u9664\u5168\u6587\u7D22\u5F15\u548C\u6807\u7B7E\u5173\u8054\u3002")}
          okText={t("\u5220\u9664")}
          cancelText={t("\u53D6\u6D88")}
          okButtonProps={{ danger: true }}
          onConfirm={onDelete}
        >
          <Button
            type="text"
            size="small"
            danger
            className="result-card__delete"
            icon={<DeleteOutlined/>}
            aria-label={t("\u5220\u9664\uFF1A{value0}",{value0:titleText})}
            onClick={event => event.stopPropagation()}
            onKeyDown={event => event.stopPropagation()}
          />
        </Popconfirm>}
      </span>
    </div>
    <h3 className="result-card__title" title={titleText}>{title}</h3>
    <p className={`result-card__snippet${snippetIsUrl ? ' is-url' : ''}`}>{snippet}</p>
    <div className="result-card__footer">
      <div className="result-card__tags">
        {matchReason && matchReason !== 'all' && <span className={`search-match-reason is-${matchReason}`}>{matchReasonLabel(matchReason)}</span>}
        {tags.slice(0, 3).map(tag => <Tag key={tag} className={`search-tag${activeTags.includes(tag) ? ' is-active' : ''}`}>{tag}</Tag>)}
        {tags.length > 3 && <span className="search-tag search-tag--more">+{tags.length - 3}</span>}
        {tags.length === 0 && availability && <span className={`result-card__availability${availability === 'snapshot' ? ' is-snapshot' : ''}`}>
          {availability === 'snapshot' ? <><FileTextOutlined/> {t("\u6B63\u6587\u5FEB\u7167")}</>:<><ClockCircleOutlined/> {t("\u4EC5\u9605\u8BFB\u8BB0\u5F55")}</>}
        </span>}
      </div>
      <div className="result-card__aside">
        {activity && status ? <>
          <span className={`reading-state reading-state--${status}`}><i aria-hidden="true"/>{readingStatusLabel(status)}</span>
          <span className="result-card__duration">{formatDuration(activity.activeSeconds)}</span>
        </> : savedAt ? <span className="result-card__saved-at">
          {wordCount ? <>{formatWordCount(wordCount)} · </> : null}{t("\u4FDD\u5B58\u4E8E")} {formatSavedAt(savedAt)}
        </span> : null}
      </div>
    </div>
    {activity && <div className={`reading-progress reading-progress--${status}`} role="img" aria-label={t("\u6EDA\u52A8 {value0}%",{value0:scroll})}title={t("\u6EDA\u52A8 {value0}%",{value0:scroll})}>
      <span className="reading-progress__track"><i style={{ width: `${scroll}%` }}/></span>
      <em>{scroll}%</em>
    </div>}
  </article>
}

function matchReasonLabel(reason: string): string {
  return ({ title:t("\u6807\u9898\u547D\u4E2D"),tag:t("\u6807\u7B7E\u547D\u4E2D"),pinyin:t("\u62FC\u97F3\u547D\u4E2D"),alias:t("\u522B\u540D\u547D\u4E2D"),summary:t("\u6458\u8981\u547D\u4E2D"),content:t("\u6B63\u6587\u547D\u4E2D")}as Record<string,string>)[reason]??t("\u5185\u5BB9\u547D\u4E2D")
}

function readingStatus(activity?: ReadingActivity): 'seen' | 'read' | 'deep' {
  if (!activity) return 'seen'
  if (activity.activeSeconds >= 120 || activity.maxScrollDepth >= 0.7) return 'deep'
  if (activity.activeSeconds >= 30 && activity.maxScrollDepth >= 0.2) return 'read'
  return 'seen'
}

function readingStatusLabel(status: 'seen' | 'read' | 'deep'): string {
  return status === 'deep' ?t("\u6DF1\u5EA6\u9605\u8BFB"):status==='read'?t("\u5DF2\u9605\u8BFB"):t("\u6D4F\u89C8\u8FC7")
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return t("{value0}\u79D2",{value0:seconds})
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return seconds % 60 === 0 ?t("{value0}\u5206\u949F",{value0:minutes}):t("{value0}\u5206{value1}\u79D2",{value0:minutes,value1:seconds%60})
  return t("{value0}\u5C0F\u65F6{value1}\u5206",{value0:Math.floor(minutes/60),value1:minutes%60})
}

function formatWordCount(count: number): string {
  return count >= 10000 ?t("{value0} \u4E07\u5B57",{value0:(count/10000).toFixed(1)}):t("{value0} \u5B57",{value0:count.toLocaleString('zh-CN')})
}

function formatSavedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const year = date.getFullYear() === now.getFullYear() ? '' :t("{value0}\u5E74",{value0:date.getFullYear()})
  return t("{value0}{value1}\u6708{value2}\u65E5",{value0:year,value1:date.getMonth()+1,value2:date.getDate()})
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '') || url
  } catch {
    return url.replace(/^https?:\/\//i, '').split('/')[0] ||t("\u7F51\u9875")
  }
}

function domainInitial(domain: string): string {
  const match = domain.match(/[a-z0-9\u4e00-\u9fa5]/i)
  return match ? match[0].toUpperCase() : '·'
}

function domainTone(domain: string): number {
  let hash = 0
  for (let index = 0; index < domain.length; index += 1) hash = (hash * 31 + domain.charCodeAt(index)) % 997
  return hash % 4
}

function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length || !text) return <>{text}</>
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi')
  const parts = text.split(pattern)
  return <>{parts.map((part, index) => terms.some(term => part.toLowerCase() === term.toLowerCase()) ? <mark key={index} className="search-highlight">{part}</mark> : <Fragment key={index}>{part}</Fragment>)}</>
}

function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

function extractSummary(summary: string | undefined, markdown: string | undefined, max = 220): string {
  const raw = (summary && summary.trim()) || stripMarkdown(markdown || '')
  if (!raw) return ''
  const firstPara = raw.split(/\n{2,}/).find(paragraph => paragraph.trim().length > 0) ?? raw
  const collapsed = firstPara.replace(/\s*\n\s*/g, ' ').trim()
  return collapsed.length > max ? `${collapsed.slice(0, max).trimEnd()}…` : collapsed
}

function stripMarkdown(md: string): string {
  return md
    .replace(/!\[[^\]]*]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`>]+/g, '')
}