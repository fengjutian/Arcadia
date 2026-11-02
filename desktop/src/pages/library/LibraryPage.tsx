import { t } from '../../i18n'
import { Button, Input, message, Modal, Segmented, Skeleton, Tabs, Tag, Typography, Upload } from '../../components/ui'
import { BookOutlined, ClockCircleOutlined, DeleteOutlined, FileTextOutlined, FolderOpenOutlined, FolderOutlined, GlobalOutlined, PlusOutlined, ReloadOutlined, RightOutlined, SearchOutlined, StarOutlined, UploadOutlined } from '../../components/ui/icons'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { DocumentCard } from '../../features/documents/DocumentCard'
import { DocumentDetailDrawer } from '../../features/documents/DocumentDetailDrawer'
import { loadDocuments } from '../../features/documents/documentService'
import {
  createCollection,
  deleteArchivedTab,
  deleteCollection,
  listArchivedTabs,
  listBrowserHistory,
  listCollections,
  saveDocument,
  toggleStarred,
  type ArchivedTab,
  type Collection,
} from '../../api'
import type { HistoryEntry } from '../../features/history/dedupeHistory'
import { formatArchivedAt, groupArchivedTabs } from '../../features/archive/archive'
import { trackDownload, type DownloadEntry } from '../../features/downloads/trackDownload'
import { useDownloadCenter } from '../../features/downloads/useDownloadCenter'
import { DownloadCenter } from '../../features/downloads/DownloadCenter'
import type { Document } from '../../types'

type SortMode = 'recent' | 'title' | 'words'

function TabLabel({ label, count }: { label: string; count: number }) {
  return <span className="library-tab-label"><span>{label}</span><span className="library-tab-count">{count}</span></span>
}

function OverviewMetric({ icon, label, value, hint }: { icon: ReactNode; label: string; value: number; hint: string }) {
  return <div className="library-metric">
    <span className="library-metric__icon">{icon}</span>
    <span className="library-metric__body">
      <span className="library-metric__label">{label}</span>
      <strong className="library-metric__value">{value}</strong>
    </span>
    <span className="library-metric__hint">{hint}</span>
  </div>
}

function hostOf(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' }
}

function formatWhen(value: number) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function LibraryPage({ onOpenBrowser }: { onOpenBrowser?: () => void }) {
  const [documents, setDocuments] = useState<Document[]>([])
  const [collections, setCollections] = useState<Collection[]>([])
  const [selected, setSelected] = useState<Document | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [archived, setArchived] = useState<ArchivedTab[]>([])
  const [downloads, setDownloads] = useState<DownloadEntry[]>([])
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortMode>('recent')
  const [tab, setTab] = useState('documents')
  const [addOpen, setAddOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const downloadCenter = useDownloadCenter()
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [messageApi, contextHolder] = message.useMessage()

  async function refreshCollections() { setCollections(await listCollections()) }

  async function reloadDocuments() {
    const result = await loadDocuments()
    setDocuments(result.items)
    setUnavailable(result.unavailable)
    setLoadError(result.error)
    setLoaded(true)
  }

  async function refreshLibrary() {
    if (refreshing) return
    setRefreshing(true)
    try {
      await Promise.all([
        reloadDocuments(),
        refreshCollections(),
        listBrowserHistory().then(setHistory),
        listArchivedTabs().then(setArchived),
        downloadCenter.refresh(),
      ])
      messageApi.success(t("\u77E5\u8BC6\u5E93\u5DF2\u5237\u65B0"))
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message :t("\u5237\u65B0\u5931\u8D25"))
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    void reloadDocuments()
    void listBrowserHistory().then(setHistory)
    void listArchivedTabs().then(setArchived)
    void refreshCollections()
  }, [])

  function onExported(document: Document) {
    setDownloads(current => trackDownload(current, { documentId: document.id, title: document.title, exportedAt: Date.now() }))
  }

  async function toggleStar(document: Document) {
    const next = !document.starred
    const previous = documents
    setDocuments(items => items.map(item => item.id === document.id ? { ...item, starred: next } : item))
    try {
      await toggleStarred(document.id, next)
      messageApi.success(next ?t("\u5DF2\u6536\u85CF"):t("\u5DF2\u53D6\u6D88\u6536\u85CF"))
    } catch (error) {
      setDocuments(previous)
      messageApi.error(error instanceof Error ? error.message :t("\u6536\u85CF\u72B6\u6001\u66F4\u65B0\u5931\u8D25"))
    }
  }

  async function handleArchived(document: Document) {
    setDocuments(items => items.map(item => item.id === document.id ? { ...item, status: 'ARCHIVED' } : item))
  }

  function handleDeleted(document: Document) {
    setDocuments(items => items.filter(item => item.id !== document.id))
    if (selected?.id === document.id) setSelected(null)
  }

  async function handleDocumentUpdated(document: Document) {
    setDocuments(items => items.map(item => item.id === document.id ? document : item))
    await refreshCollections()
  }

  async function createNewCollection() {
    const name = newName.trim()
    if (!name) return
    try {
      await createCollection(name)
      setNewName('')
      setCreating(false)
      await refreshCollections()
      messageApi.success(t("\u96C6\u5408\u5DF2\u521B\u5EFA"))
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message :t("\u521B\u5EFA\u96C6\u5408\u5931\u8D25"))
    }
  }

  async function removeCollection(collection: Collection) {
    try {
      await deleteCollection(collection.id)
      await refreshCollections()
      messageApi.success(t("\u96C6\u5408\u5DF2\u5220\u9664"))
    } catch {
      messageApi.error(t("\u5220\u9664\u96C6\u5408\u5931\u8D25"))
    }
  }

  async function importMarkdown(file: File) {
    if (!/\.(md|markdown|txt)$/i.test(file.name)) {
      messageApi.error(t("\u8BF7\u9009\u62E9 .md\u3001.markdown \u6216 .txt \u6587\u4EF6"))
      return false
    }
    const markdown = await file.text()
    if (!markdown.trim()) {
      messageApi.error(t("\u6587\u4EF6\u5185\u5BB9\u4E3A\u7A7A"))
      return false
    }
    setImporting(true)
    try {
      const title = file.name.replace(/\.[^.]+$/, '') ||t("\u672A\u547D\u540D\u6587\u6863")
      const saved = await saveDocument({
        title,
        url: `file:///${encodeURIComponent(file.name)}`,
        markdown,
        tags: [t("\u5BFC\u5165")],
      })
      if (!saved) throw new Error(t("\u672C\u5730\u6570\u636E\u670D\u52A1\u672A\u8FD4\u56DE\u6587\u6863"))
      setDocuments(items => [saved, ...items])
      setTab('documents')
      setAddOpen(false)
      messageApi.success(t("\u5DF2\u5BFC\u5165\u300C{value0}\u300D",{value0:title}))
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message :t("\u5BFC\u5165\u5931\u8D25"))
    } finally {
      setImporting(false)
    }
    return false
  }

  function openBrowser() {
    setAddOpen(false)
    onOpenBrowser?.()
  }

  function openHistoryEntry(entry: HistoryEntry) {
    window.dispatchEvent(new CustomEvent('arcadia-browser-open-url', { detail: { url: entry.url } }))
    onOpenBrowser?.()
  }

  function openArchived(entry: ArchivedTab) {
    window.dispatchEvent(new CustomEvent('arcadia-browser-open-url', { detail: { url: entry.url } }))
    onOpenBrowser?.()
  }

  async function removeArchived(id: string) {
    try {
      await deleteArchivedTab(id)
      setArchived(items => items.filter(item => item.id !== id))
      messageApi.success(t("\u5DF2\u5220\u9664\u5F52\u6863"))
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message :t("\u5220\u9664\u5F52\u6863\u5931\u8D25"))
    }
  }

  const visibleDocuments = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const filtered = needle
      ? documents.filter(document => [document.title, document.source, document.url, document.summary, ...document.tags]
        .filter(Boolean)
        .some(value => String(value).toLowerCase().includes(needle)))
      : documents
    return [...filtered].sort((left, right) => {
      if (sort === 'title') return left.title.localeCompare(right.title, 'zh-CN')
      if (sort === 'words') return right.wordCount - left.wordCount
      return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    })
  }, [documents, query, sort])

  const starredCount = documents.filter(item => item.starred).length
  const recentHistory = history.slice(0, 8)
  const archiveSections = groupArchivedTabs(archived)

  const documentsContent = <div className="library-module">
    <div className="library-section-head">
      <div>
        <h2>{query ?t("\u641C\u7D22\u7ED3\u679C"):t("\u6700\u8FD1\u4FDD\u5B58")}</h2>
        <p>{query ?t("\u6807\u9898\u3001\u6765\u6E90\u6216\u6807\u7B7E\u4E2D\u5305\u542B\u201C{value0}\u201D\u7684\u5185\u5BB9",{value0:query}):t("\u5DF2\u6C89\u6DC0\u5230\u672C\u5730\u77E5\u8BC6\u5E93\u7684\u5185\u5BB9\uFF0C\u6309\u4FDD\u5B58\u65F6\u95F4\u6392\u5217\u3002")}</p>
      </div>
      {documents.length > 0 && <div className="library-section-head__tools">
        <span className="library-result-count">{visibleDocuments.length} {t("\u7BC7")}</span>
        <Segmented
          size="small"
          value={sort}
          onChange={value => setSort(value as SortMode)}
          options={[
            { label:t("\u6700\u8FD1"),value:'recent'},
            { label:t("\u6807\u9898"),value:'title'},
            { label:t("\u5B57\u6570"),value:'words'},
          ]}
        />
      </div>}
    </div>
    {!loaded
      ? <Skeleton active/>
      : unavailable
        ? <div className="library-empty-state">
            <span className="library-empty-state__icon"><BookOutlined/></span>
            <h3>{t("\u672C\u5730\u6570\u636E\u5E93\u6682\u65F6\u4E0D\u53EF\u7528")}</h3>
            <p>{t("\u8BFB\u53D6\u672C\u673A knowledge.db \u5931\u8D25\u3002\u5185\u5BB9\u90FD\u5728\u8FD9\u53F0\u673A\u5668\u4E0A\uFF0C\u4E0D\u9700\u8981\u8FDE\u63A5\u4EFB\u4F55\u670D\u52A1\uFF1B\u53EF\u4EE5\u5148\u91CD\u8BD5\uFF0C\u82E5\u53CD\u590D\u5931\u8D25\u8BF7\u9644\u4E0A\u4E0B\u65B9\u7684\u9519\u8BEF\u4FE1\u606F\u3002")}</p>
            {loadError && <code className="library-empty-state__detail" title={loadError}>{loadError}</code>}
            <div className="library-empty-state__actions">
              <Button type="primary" onClick={() => void reloadDocuments()}>{t("\u91CD\u8BD5")}</Button>
            </div>
          </div>
        : documents.length === 0
          ? <div className="library-empty-state">
              <span className="library-empty-state__icon"><BookOutlined/></span>
              <h3>{t("\u77E5\u8BC6\u5E93\u8FD8\u5F88\u5B89\u9759")}</h3>
              <p>{t("\u6D4F\u89C8\u7F51\u9875\u65F6\u70B9\u51FB\u5DE5\u5177\u680F\u7684\u300C\u4FDD\u5B58\u5230\u77E5\u8BC6\u5E93\u300D\uFF0C\u6B63\u6587\u3001\u6807\u9898\u548C\u6765\u6E90\u4F1A\u81EA\u52A8\u5F52\u6863\u5230\u8FD9\u91CC\u3002")}</p>
              <div className="library-empty-state__actions">
                <Button type="primary" icon={<PlusOutlined/>} onClick={() => setAddOpen(true)}>{t("\u6DFB\u52A0\u6587\u6863")}</Button>
                {onOpenBrowser && <Button onClick={openBrowser}>{t("\u53BB\u6D4F\u89C8\u5668\u901B\u901B")}</Button>}
              </div>
            </div>
          : visibleDocuments.length === 0
            ? <div className="library-no-results">
                <SearchOutlined/>
                <h3>{t("\u6CA1\u6709\u627E\u5230\u5339\u914D\u7684\u6587\u6863")}</h3>
                <p>{t("\u6362\u4E2A\u5173\u952E\u8BCD\uFF0C\u6216\u8005\u6E05\u9664\u641C\u7D22\u67E5\u770B\u5168\u90E8\u5185\u5BB9\u3002")}</p>
                <Button type="text" onClick={() => setQuery('')}>{t("\u6E05\u9664\u641C\u7D22")}</Button>
              </div>
            : <div className="library-document-grid">
                {visibleDocuments.map(document => <DocumentCard key={document.id} document={document} onOpen={setSelected} onToggleStarred={toggleStar} onArchived={handleArchived} onDeleted={handleDeleted} onChanged={refreshCollections}/>)}
                {!query && visibleDocuments.length < 3 && <button type="button" className="library-add-tile" onClick={() => setAddOpen(true)}>
                  <span className="library-add-tile__icon"><PlusOutlined/></span>
                  <strong>{t("\u6DFB\u52A0\u4E0B\u4E00\u7BC7")}</strong>
                  <small>{t("\u4ECE\u6D4F\u89C8\u5668\u4FDD\u5B58\uFF0C\u6216\u5BFC\u5165\u672C\u5730 Markdown")}</small>
                </button>}
              </div>}
  </div>

  const collectionContent = <div className="library-module">
    <div className="library-section-head">
      <div>
        <h2>{t("\u96C6\u5408")}</h2>
        <p>{t("\u6309\u4E3B\u9898\u6574\u7406\u4FDD\u5B58\u7684\u7F51\u9875\u548C\u7B14\u8BB0\u3002")}</p>
      </div>
      <Button icon={<PlusOutlined/>} onClick={() => setCreating(true)}>{t("\u65B0\u5EFA\u96C6\u5408")}</Button>
    </div>
    {collections.length === 0
      ? <div className="library-empty-state library-empty-state--compact">
          <span className="library-empty-state__icon"><FolderOpenOutlined/></span>
          <h3>{t("\u8FD8\u6CA1\u6709\u96C6\u5408")}</h3>
          <p>{t("\u628A\u540C\u4E00\u4E3B\u9898\u7684\u6587\u6863\u6536\u8FDB\u4E00\u4E2A\u96C6\u5408\uFF0C\u4E4B\u540E\u53EF\u4EE5\u6574\u7EC4\u68C0\u7D22\u4E0E\u56DE\u987E\u3002")}</p>
          <Button icon={<PlusOutlined/>} onClick={() => setCreating(true)}>{t("\u65B0\u5EFA\u96C6\u5408")}</Button>
        </div>
      : <div className="library-collection-grid">
          {collections.map(collection => <article className="library-collection" key={collection.id}>
            <div className="library-collection__head">
              <span className="library-collection__icon"><FolderOutlined/></span>
              <Tag>{collection.documentCount} {t("\u7BC7")}</Tag>
            </div>
            <h3>{collection.name}</h3>
            <p>{collection.description ||t("\u8FD8\u6CA1\u6709\u6DFB\u52A0\u63CF\u8FF0\u3002")}</p>
            <div className="library-collection__footer">
              <span>{new Date(collection.createdAt).toLocaleDateString('zh-CN')} {t("\u521B\u5EFA")}</span>
              <Button danger type="text" size="small" icon={<DeleteOutlined/>} onClick={() => void removeCollection(collection)}>{t("\u5220\u9664")}</Button>
            </div>
          </article>)}
        </div>}
  </div>

  const historyContent = <div className="library-module">
    <div className="library-section-head">
      <div>
        <h2>{t("\u8FD1\u671F\u6D4F\u89C8")}</h2>
        <p>{t("\u6700\u8FD1\u8BBF\u95EE\u8FC7\u7684\u7F51\u9875\uFF0C\u70B9\u51FB\u5373\u53EF\u5728\u6D4F\u89C8\u5668\u4E2D\u91CD\u65B0\u6253\u5F00\u3002")}</p>
      </div>
      <span className="library-result-count">{recentHistory.length} {t("\u6761")}</span>
    </div>
    {recentHistory.length === 0
      ? <div className="library-empty-state library-empty-state--compact">
          <span className="library-empty-state__icon"><ClockCircleOutlined/></span>
          <h3>{t("\u6682\u65E0\u6D4F\u89C8\u8BB0\u5F55")}</h3>
          <p>{t("\u6D4F\u89C8\u8FC7\u7684\u9875\u9762\u4F1A\u6309\u65F6\u95F4\u5012\u5E8F\u51FA\u73B0\u5728\u8FD9\u91CC\u3002")}</p>
        </div>
      : <div className="library-activity-list">
          {recentHistory.map(item => <button key={item.url + item.visitedAt} type="button" className="library-activity" onClick={() => openHistoryEntry(item)}>
            <span className="library-activity__icon"><GlobalOutlined/></span>
            <span className="library-activity__body">
              <strong title={item.title || item.url}>{item.title || item.url}</strong>
              <small><span>{hostOf(item.url) || item.url}</span><span>{formatWhen(item.visitedAt)}</span></small>
            </span>
            <RightOutlined className="library-activity__arrow"/>
          </button>)}
        </div>}
  </div>

  const archiveContent = <div className="library-module">
    <div className="library-section-head">
      <div>
        <h2>{t("\u5F52\u6863")}</h2>
        <p>{t("\u4ECE\u6807\u7B7E\u680F\u6536\u8D77\u4F46\u8FD8\u6CA1\u6709\u4FDD\u5B58\u7684\u9875\u9762\u3002\u53EF\u6309\u6807\u9898\u6216\u7F51\u5740\u627E\u56DE\uFF0C\u4E5F\u53EF\u4EE5\u968F\u65F6\u5220\u9664\u3002")}</p>
      </div>
      <span className="library-result-count">{archived.length} {t("\u6761")}</span>
    </div>
    {archived.length === 0
      ? <div className="library-empty-state library-empty-state--compact">
          <span className="library-empty-state__icon"><ClockCircleOutlined/></span>
          <h3>{t("\u8FD8\u6CA1\u6709\u5F52\u6863")}</h3>
          <p>{t("\u5728\u6807\u7B7E\u9875\u53F3\u952E\u9009\u62E9\u300C\u5F52\u6863\u6807\u7B7E\u9875\u300D\uFF0C\u6216\u4ECE\u547D\u4EE4\u680F\u6267\u884C\u5F52\u6863\u3002\u5F52\u6863\u4E0D\u4F1A\u5220\u9664\u9875\u9762\uFF0C\u53EA\u662F\u8BA9\u5B83\u79BB\u5F00\u6807\u7B7E\u680F\u3002")}</p>
        </div>
      : archiveSections.map(section => <section key={section.bucket} className="library-archive-group">
          <h3 className="library-archive-group__title">{section.label}<span>{section.items.length}</span></h3>
          {section.items.map(item => <div className="library-archive-row" key={item.id}>
            <button type="button" className="library-activity" onClick={() => openArchived(item)}>
              <span className="library-activity__icon"><GlobalOutlined/></span>
              <span className="library-activity__body">
                <strong title={item.title || item.url}>{item.title || item.url}</strong>
                <small><span>{hostOf(item.url) || item.url}</span><span>{formatArchivedAt(item.archivedAt)}</span></small>
              </span>
              <RightOutlined className="library-activity__arrow"/>
            </button>
            <Button type="text" size="small" danger icon={<DeleteOutlined/>} aria-label={t("\u5220\u9664\u5F52\u6863")}onClick={()=>void removeArchived(item.id)}/>
          </div>)}
        </section>)}
  </div>

  const downloadContent = <div className="library-module">
    <div className="library-section-head">
      <div>
        <h2>{t("\u4E0B\u8F7D\u8BB0\u5F55")}</h2>
        <p>{t("\u6D4F\u89C8\u5668\u4E0B\u8F7D\u7684\u6587\u4EF6\u4E0E\u672C\u6B21\u4F1A\u8BDD\u5BFC\u51FA\u7684 Markdown\uFF0C\u91CD\u542F\u540E\u4ECD\u4F1A\u4FDD\u7559\u5DF2\u5B8C\u6210\u7684\u4E0B\u8F7D\u3002")}</p>
      </div>
      <span className="library-result-count">{downloadCenter.records.length} {t("\u9879")}</span>
    </div>
    {downloads.length > 0 && <div className="library-export-list">
      <div className="library-export-list__head"><span>{t("\u672C\u6B21\u4F1A\u8BDD\u5BFC\u51FA")}</span><small>{downloads.length} {t("\u4EFD")}</small></div>
      {downloads.map(entry => <div className="library-export-row" key={`${entry.documentId}-${entry.exportedAt}`}>
        <span className="library-export-row__icon"><FileTextOutlined/></span>
        <span className="library-export-row__title" title={entry.title}>{entry.title}</span>
        <small>{formatWhen(entry.exportedAt)}</small>
      </div>)}
    </div>}
    <div className="library-downloads"><DownloadCenter center={downloadCenter}/></div>
  </div>

  return <section className="page library-page">
    {contextHolder}
    <div className="library-page__inner">
      <header className="library-header">
        <div className="library-header__copy">
          <span className="eyebrow">KNOWLEDGE BASE</span>
          <h1>{t("\u4F60\u7684\u77E5\u8BC6\u5E93")}</h1>
          <p>{t("\u4FDD\u5B58\u7684\u7F51\u9875\u4F1A\u5728\u8FD9\u91CC\u6C89\u6DC0\u3001\u7EC4\u7EC7\u5E76\u88AB\u91CD\u65B0\u53D1\u73B0\u3002")}</p>
        </div>
        <div className="library-header__actions">
          <Input
            className="library-search"
            prefix={<SearchOutlined/>}
            placeholder={t("\u641C\u7D22\u6807\u9898\u3001\u6765\u6E90\u6216\u6807\u7B7E")}
            value={query}
            allowClear
            onChange={event => {
              setQuery(event.target.value)
              if (event.target.value) setTab('documents')
            }}
          />
          <Button className="library-add-button" type="primary" icon={<PlusOutlined/>} onClick={() => setAddOpen(true)}>{t("\u6DFB\u52A0\u6587\u6863")}</Button>
        </div>
      </header>

      <div className="library-page__body">
        <div className="library-overview" aria-label={t("\u77E5\u8BC6\u5E93\u6982\u89C8")}>
          <OverviewMetric icon={<BookOutlined/>} label={t("\u5168\u90E8\u6587\u6863")}value={documents.length}hint={t("\u7F51\u9875\u4E0E\u7B14\u8BB0")}/>
          <OverviewMetric icon={<StarOutlined/>} label={t("\u6536\u85CF")}value={starredCount}hint={t("\u503C\u5F97\u91CD\u8BFB")}/>
          <OverviewMetric icon={<FolderOutlined/>} label={t("\u96C6\u5408")}value={collections.length}hint={t("\u4E3B\u9898\u5F52\u6863")}/>
        </div>

        <Tabs
          className="library-tabs"
          activeKey={tab}
          onChange={setTab}
          tabBarExtraContent={
            <Button
              className="library-refresh-button"
              size="small"
              icon={<ReloadOutlined spin={refreshing}/>}
              disabled={refreshing}
              onClick={() => void refreshLibrary()}
            >
              {refreshing ?t("\u5237\u65B0\u4E2D"):t("\u5237\u65B0")}
            </Button>
          }
          items={[
            { key: 'documents', label: <TabLabel label={t("\u6700\u8FD1\u4FDD\u5B58")}count={documents.length}/>,children:documentsContent},
            { key: 'collections', label: <TabLabel label={t("\u96C6\u5408")}count={collections.length}/>,children:collectionContent},
            { key: 'history', label: <TabLabel label={t("\u8FD1\u671F\u6D4F\u89C8")}count={recentHistory.length}/>,children:historyContent},
            { key: 'archive', label: <TabLabel label={t("\u5F52\u6863")}count={archived.length}/>,children:archiveContent},
            { key: 'downloads', label: <TabLabel label={t("\u4E0B\u8F7D\u8BB0\u5F55")}count={downloadCenter.records.length}/>,children:downloadContent},
          ]}
        />
      </div>
    </div>

    <Modal title={t("\u6DFB\u52A0\u6587\u6863")}open={addOpen}onCancel={()=>setAddOpen(false)}footer={null}width={580}className="library-add-modal">
      <Typography.Paragraph className="library-add-intro">{t("\u628A\u7F51\u9875\u6216\u672C\u5730 Markdown \u6C89\u6DC0\u5230\u77E5\u8BC6\u5E93\uFF0C\u6240\u6709\u5185\u5BB9\u53EA\u4FDD\u5B58\u5728\u8FD9\u53F0\u8BBE\u5907\u4E0A\u3002")}</Typography.Paragraph>
      <div className="library-add-actions">
        <button type="button" className="library-add-card" onClick={openBrowser}>
          <span className="library-add-card__icon"><GlobalOutlined/></span>
          <span className="library-add-card__body">
            <strong>{t("\u4ECE\u6D4F\u89C8\u5668\u4FDD\u5B58")}</strong>
            <small>{t("\u6D4F\u89C8\u7F51\u9875\u65F6\u70B9\u51FB\u5DE5\u5177\u680F\u7684\u300C\u4FDD\u5B58\u5230\u77E5\u8BC6\u5E93\u300D\uFF0C\u6B63\u6587\u3001\u6807\u9898\u548C\u6765\u6E90\u4F1A\u81EA\u52A8\u5F52\u6863\u3002")}</small>
          </span>
          <RightOutlined className="library-add-card__arrow"/>
        </button>
        <div className="library-add-drop">
          <Upload.Dragger accept=".md,.markdown,.txt" disabled={importing} beforeUpload={importMarkdown}>
            <strong>{importing ?t("\u6B63\u5728\u5BFC\u5165\u2026"):t("\u5BFC\u5165 Markdown \u6587\u4EF6")}</strong>
            <small>{t("\u62D6\u5165\u6216\u70B9\u51FB\u9009\u62E9 .md / .markdown / .txt \u6587\u4EF6\uFF0C\u5BFC\u5165\u540E\u4F1A\u81EA\u52A8\u6392\u961F\u751F\u6210\u6807\u7B7E\u4E0E\u7D22\u5F15\u3002")}</small>
          </Upload.Dragger>
        </div>
      </div>
      <div className="library-add-note"><UploadOutlined/> {t("\u5BFC\u5165\u4E0D\u4F1A\u4FEE\u6539\u539F\u6587\u4EF6\uFF0C\u4E5F\u4E0D\u4F1A\u628A\u5185\u5BB9\u4E0A\u4F20\u5230\u7F51\u7EDC\u3002")}</div>
    </Modal>

    <Modal title={t("\u65B0\u5EFA\u96C6\u5408")}open={creating}onCancel={()=>{setCreating(false);setNewName('')}}onOk={()=>void createNewCollection()}okText={t("\u521B\u5EFA")}cancelText={t("\u53D6\u6D88")}>
      <Input autoFocus placeholder={t("\u96C6\u5408\u540D\u79F0")}value={newName}onChange={event=>setNewName(event.target.value)}onPressEnter={()=>void createNewCollection()}/>
    </Modal>
    <DocumentDetailDrawer document={selected} onClose={() => setSelected(null)} onDeleted={id => setDocuments(items => items.filter(item => item.id !== id))} onExported={onExported} onUpdated={handleDocumentUpdated}/>
  </section>
}