import { formatNumber, getLocale, t } from '../../i18n'
import { AutoComplete, Button, Input, message, Modal, Popconfirm, Select, Spin, Tag, Typography, type InputRef } from '../../components/ui'
import { BookOutlined, ClockCircleOutlined, DeleteOutlined, FileTextOutlined, InboxOutlined, SearchOutlined, StarFilled, StarOutlined } from '../../components/ui/icons'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { PageHeader } from '../../shared/components/PageHeader'
import { DocumentDetailDrawer } from '../../features/documents/DocumentDetailDrawer'
import { deleteDocument, deleteReadingSnapshot, listArchivedTabs, searchDocuments, searchPageNotes, listReadingActivity, getSearchSuggestions, getSession, setSession, type ArchivedTab, type DocumentSearchHit, type PageNote } from '../../api'
import { formatArchivedAt } from '../../features/archive/archive'
import { PeekDrawer, type PeekTarget } from '../../features/peek/PeekDrawer'
import type { ReadingActivity } from '../../types'
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue'
import { renderHighlightedSnippet } from '../../features/search/renderSnippet'
import { X } from 'lucide-react'
import { dedupeSearchResults, matchesAdvancedSearch, parseAdvancedSearch } from '../../features/search/advancedSearch'

type SortKey = 'recent' | 'oldest' | 'starred' | 'relevance'

const SORT_OPTIONS: Array<{ label: string; value: SortKey }> = [
  { label:t("最新"),value:'recent'},
  { label:t("最早"),value:'oldest'},
  { label:t("收藏优先"),value:'starred'},
]

export function SearchPage({ initialQuery = '', onOpenUrl }: { initialQuery?: string; onOpenUrl?: (url: string) => void }) {
  const [messageApi, contextHolder] = message.useMessage()
  const [query, setQuery] = useState(initialQuery)
  const debouncedQuery = useDebouncedValue(query, 250)
  const advancedQuery = useMemo(() => parseAdvancedSearch(debouncedQuery), [debouncedQuery])
  const [documents, setDocuments] = useState<DocumentSearchHit[]>([])
  const [reading, setReading] = useState<ReadingActivity[]>([])
  const [notes, setNotes] = useState<PageNote[]>([])
  const [archived, setArchived] = useState<ArchivedTab[]>([])
  const [peek, setPeek] = useState<PeekTarget | null>(null)
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
    const noteResults = advancedQuery.text.trim()
      ? searchPageNotes(advancedQuery.text)
      : Promise.resolve<PageNote[]>([])
    const archivedResults = advancedQuery.text.trim()
      ? listArchivedTabs(advancedQuery.text, 50)
      : Promise.resolve<ArchivedTab[]>([])
    void Promise.all([searchDocuments(advancedQuery.text), listReadingActivity(), noteResults, archivedResults])
      .then(([items, activity, noteItems, archivedItems]) => {
        if (!current) return
        setDocuments(items)
        setReading(activity)
        setNotes(noteItems)
        setArchived(archivedItems)
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
        console.error(t("[search] 读取本地知识库失败"),error)
        setDocuments([])
        setReading([])
        setNotes([])
        setArchived([])
        setUnavailable(true)
        setLoadError(detail ||t("未知错误"))
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
  const total = filtered.length + unsavedReading.length + notes.length + archived.length
  const showEmpty = !loading && total === 0

  const sortOptions = useMemo(() => hasQuery ? [{ label:t("相关度"),value:'relevance'as const},...SORT_OPTIONS]:SORT_OPTIONS,[hasQuery])

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

  const openNote = useCallback((note: PageNote) => {
    if (debouncedQuery.trim()) rememberQuery(debouncedQuery)
    setPeek({ kind: 'note', note })
  }, [debouncedQuery, rememberQuery])

  const openArchived = useCallback((item: ArchivedTab) => {
    if (debouncedQuery.trim()) rememberQuery(debouncedQuery)
    setPeek({ kind: 'archive', entry: item })
  }, [debouncedQuery, rememberQuery])

  const removeDocument = useCallback(async (item: DocumentSearchHit) => {
    try {
      await deleteDocument(item.id)
      setDocuments(items => items.filter(document => document.id !== item.id))
      if (selected?.id === item.id) setSelected(null)
      messageApi.success(t("已删除"))
    } catch {
      messageApi.error(t("删除失败，请稍后重试"))
    }
  }, [messageApi, selected?.id])

  return <section className="page search-page">
    {contextHolder}
    <PageHeader
      eyebrow="LOCAL SEARCH"
      title={t("找回你读过的内容")}
      description={t("搜索保存在本地 SQLite 中的真实网页内容。")}
      extra={<div className={`search-status${loading ? ' is-loading' : ''}${unavailable ? ' is-error' : ''}`} aria-live="polite">
        <span className="search-status__dot" aria-hidden="true"/>
        {loading
          ? <span>{t("正在检索本地索引\u2026")}</span>
          : unavailable
            ? <span>{t("本地数据库不可用")}</span>
            : <span>{t("找到")} <b>{total}</b> {t("条内容 \xB7")} <span className="search-status__latency">{durationMs??'—'} ms</span></span>}
      </div>}
    />

    <div className="search-page__body">
      <div className="search-console">
        <AutoComplete options={searchSuggestions.map(         (value                  )=>({value,label:value}))} value={query} onChange={setQuery} onSelect={value=>{setQuery(value);rememberQuery(value)}}>
        <Input
          ref={searchRef}
          size="large"
          className="search-console__input"
          prefix={<SearchOutlined/>}
          value={query}
          onChange={event => setQuery(event.target.value)}
          onPressEnter={() => rememberQuery(query)}
          placeholder={t("搜索标题、正文或标签")}
          allowClear
          autoFocus
          aria-label={t("搜索标题、正文或标签")}
        />
        </AutoComplete>

        {recentQueries.length > 0 && !query &&(
          <div className="search-recent">
            <span className="search-recent__label"><ClockCircleOutlined/> {t("最近搜索")}</span>
            {recentQueries.slice(0, 6).map(        (item

            )                                   =>(<button key={item} type="button" className="search-recent__item" onClick={()=>{setQuery(item);searchRef.current?.focus({cursor:'end'})}}>{item}</button>))}
          </div>)
         }

        <div className="search-console__footer">
          <div className="search-filters" role="group" aria-label={t("筛选搜索结果")}>
            {allTags.length > 0 && <Select<string>
              mode="multiple"
              className="search-tag-filter"
              ariaLabel={t("按标签筛选")}
              options={allTags.map(       (tag                       )=>({label:tag,value:tag}))}
              placeholder={t("全部标签")}
              value={tagFilter}
              onChange={value => setTagFilter(Array.isArray(value) ? value : [])}
            />}
            <button type="button" className={`search-filter${starredOnly ? ' is-active' : ''}`} aria-pressed={starredOnly} onClick={() => setStarredOnly(value => !value)} title={t("只显示已收藏的内容")}>
              <StarOutlined/> {t("仅收藏")} 
            </button>
            <button type="button" className={`search-filter${readOnly ? ' is-active' : ''}`} aria-pressed={readOnly} onClick={() => setReadOnly(value => !value)} title={t("只显示达到阅读时长或滚动深度的内容")}>
              <BookOutlined/> {t("确实读过")} 
            </button>
            <button type="button" className={`search-filter${includeArchived ? ' is-active' : ''}`} aria-pressed={includeArchived} onClick={() => setIncludeArchived(value => !value)} title={t("同时显示已归档的内容")}>
              <InboxOutlined/> {t("含归档")} 
            </button>
            {hasFilters && <button type="button" className="search-filters__reset" onClick={resetFilters}><X size={12}/> {t("清除筛选")}</button>}
          </div>
          <div className="search-sort">
            <span className="search-sort__label">{t("排序")}</span>
            <Select<SortKey> className="search-sort__select" ariaLabel={t("排序方式")} options={sortOptions} value={sort} onChange={value=>setSort(value)}/>
          </div>
        </div>
      </div>

      {loading && total === 0 && <div className="search-loading" aria-live="polite"><Spin size="small"/><span>{t("正在检索本地索引\u2026")}</span></div>}

      {showEmpty &&( unavailable
        ? <SearchEmpty
            title={t("本地数据库暂时不可用")}
            description={t("读取本机 knowledge.db 失败。内容都在这台机器上，不需要连接或启动任何服务；可以先重试，若反复失败请附上下方的错误信息。")}
            detail={loadError}
            action={<Button onClick={() => setReloadToken(value => value + 1)}>{t("重试")}</Button>}
          />
        : <SearchEmpty
            title={hasQuery || hasFilters ?t("没有找到匹配的内容"):t("还没有可搜索的内容")}
            description={hasQuery || hasFilters ?t("试试更短的关键词，或减少筛选条件。"):t("浏览网页后，保存的文章和阅读记录会出现在这里。")}
            action={hasQuery || hasFilters ? <>
              {hasQuery && <Button onClick={() => { setQuery(''); searchRef.current?.focus() }}>{t("清空搜索")}</Button>}
              {hasFilters && <Button type="primary" onClick={resetFilters}>{t("清除筛选")}</Button>}
            </> : undefined}
          />)}

      {!showEmpty &&(
        <>
          {filtered.length > 0 && <section className="search-section">
            <SectionHeading title={t("已保存")} count={filtered.length} hint={t("已写入本地知识库")}/>
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

          {notes.length > 0 && <section className="search-section search-section--notes">
            <SectionHeading title={t("笔记")} count={notes.length} hint={t("网页高亮与摘录，来自划词笔记")}/>
            <div className="result-grid">
              {notes.map(note => <ResultCard
                key={note.id}
                title={<Highlight text={note.title || note.url} terms={terms}/>}
                titleText={note.title || note.url}
                url={note.url}
                snippet={<span className="search-note-snippet">
                  <span className="search-note-snippet__quote"><Highlight text={note.quote} terms={terms}/></span>
                  {note.comment && <span className="search-note-snippet__comment">{note.comment}</span>}
                </span>}
                actionLabel={t("打开原文：{value0}",{value0:note.title||note.url})}
                onOpen={() => openNote(note)}
              />)}
            </div>
          </section>}

          {archived.length > 0 && <section className="search-section search-section--archive">
            <SectionHeading title={t("浏览痕迹")} count={archived.length} hint={t("从标签栏归档的页面，尚未保存进知识库")}/>
            <div className="result-grid">
              {archived.map(item => <ResultCard
                key={item.id}
                title={<Highlight text={item.title || item.url} terms={terms}/>}
                titleText={item.title || item.url}
                url={item.url}
                snippet={<span className="search-note-snippet__comment">{t("归档于 {value0}",{value0:formatArchivedAt(item.archivedAt)})}</span>}
                actionLabel={t("打开归档页：{value0}",{value0:item.title||item.url})}
                onOpen={() => openArchived(item)}
              />)}
            </div>
          </section>}

          {unsavedReading.length > 0 && <section className="search-section search-section--reading">
            <SectionHeading title={t("读过但未保存")} count={unsavedReading.length} hint={t("保留了阅读轨迹，尚未写入知识库")}/>
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
                  actionLabel={item.markdown ?t("查看阅读快照：{value0}",{value0:item.title||item.url}):t("重新打开：{value0}",{value0:item.title||item.url})}
                />
              })}
            </div>
          </section>}
        </>)
       }
    </div>

    <Modal
      open={selectedReading !== null}
      title={selectedReading?.title ||t("阅读快照")}
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
        }}>{t("删除快照")}</Button>
        <Button onClick={() => setSelectedReading(null)}>{t("关闭")}</Button>
        <Button type="primary" onClick={() => {
          const url = selectedReading?.url
          setSelectedReading(null)
          if (url) onOpenUrl?.(url)
        }}>{t("重新打开原网页")}</Button>
      </div>}
    >
      {selectedReading && <>
        <Typography.Paragraph type="secondary" copyable>{selectedReading.url}</Typography.Paragraph>
        <Typography.Paragraph className="snapshot-body">{selectedReading.markdown}</Typography.Paragraph>
      </>}
    </Modal>
    <DocumentDetailDrawer document={selected} onClose={() => setSelected(null)} onDeleted={id => setDocuments(items => items.filter(item => item.id !== id))}/>
    <PeekDrawer target={peek} onClose={() => setPeek(null)} onOpenUrl={url => onOpenUrl?.(url)}/>
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
    aria-label={`${actionLabel ??t("打开：{value0}",{value0:titleText})}${starred?t("，已收藏"):''}`}
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
        {starred && <StarFilled className="result-card__star" role="img" aria-label={t("已收藏")}/>}
        {onDelete && <Popconfirm
          title={t("删除这篇已保存的内容？")}
          description={t("该操作会同时删除全文索引和标签关联。")}
          okText={t("删除")}
          cancelText={t("取消")}
          okButtonProps={{ danger: true }}
          onConfirm={onDelete}
        >
          <Button
            type="text"
            size="small"
            danger
            className="result-card__delete"
            icon={<DeleteOutlined/>}
            aria-label={t("删除：{value0}",{value0:titleText})}
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
          {availability === 'snapshot' ? <><FileTextOutlined/> {t("正文快照")}</>:<><ClockCircleOutlined/> {t("仅阅读记录")}</>}
        </span>}
      </div>
      <div className="result-card__aside">
        {activity && status ? <>
          <span className={`reading-state reading-state--${status}`}><i aria-hidden="true"/>{readingStatusLabel(status)}</span>
          <span className="result-card__duration">{formatDuration(activity.activeSeconds)}</span>
        </> : savedAt ? <span className="result-card__saved-at">
          {wordCount ? <>{formatWordCount(wordCount)} · </> : null}{t("保存于")} {formatSavedAt(savedAt)}
        </span> : null}
      </div>
    </div>
    {activity && <div className={`reading-progress reading-progress--${status}`} role="img" aria-label={t("滚动 {value0}%",{value0:scroll})} title={t("滚动 {value0}%",{value0:scroll})}>
      <span className="reading-progress__track"><i style={{ width: `${scroll}%` }}/></span>
      <em>{scroll}%</em>
    </div>}
  </article>
}

function matchReasonLabel(reason: string): string {
  return ({ title:t("标题命中"),tag:t("标签命中"),pinyin:t("拼音命中"),alias:t("别名命中"),summary:t("摘要命中"),content:t("正文命中")}as Record<string,string>)[reason]??t("内容命中")
}

function readingStatus(activity?: ReadingActivity): 'seen' | 'read' | 'deep' {
  if (!activity) return 'seen'
  if (activity.activeSeconds >= 120 || activity.maxScrollDepth >= 0.7) return 'deep'
  if (activity.activeSeconds >= 30 && activity.maxScrollDepth >= 0.2) return 'read'
  return 'seen'
}

function readingStatusLabel(status: 'seen' | 'read' | 'deep'): string {
  return status === 'deep' ?t("深度阅读"):status==='read'?t("已阅读"):t("浏览过")
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return t("{value0}秒",{value0:seconds})
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return seconds % 60 === 0 ?t("{value0}分钟",{value0:minutes}):t("{value0}分{value1}秒",{value0:minutes,value1:seconds%60})
  return t("{value0}小时{value1}分",{value0:Math.floor(minutes/60),value1:minutes%60})
}

function formatWordCount(count: number): string {
  if (count >= 10000) {
    const value = getLocale() === 'en-US' ? count / 1000 : count / 10000
    return t('{value0} 万字', { value0: formatNumber(value, { maximumFractionDigits: 1 }), count })
  }
  return t('{value0} 字', { value0: formatNumber(count), count })
}

function formatSavedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const year = date.getFullYear() === now.getFullYear() ? '' :t("{value0}年",{value0:date.getFullYear()})
  return t("{value0}{value1}月{value2}日",{value0:year,value1:date.getMonth()+1,value2:date.getDate()})
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '') || url
  } catch {
    return url.replace(/^https?:\/\//i, '').split('/')[0] ||t("网页")
  }
}

function domainInitial(domain: string): string {
  const match = domain.match(/[a-z0-9一-龥]/i)
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