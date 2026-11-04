import { t } from '@arcadia/i18n'
import { Button, Input, message, Modal, Popconfirm, Segmented, Select, Skeleton, Switch, Tabs, Tag, Typography, Upload } from '@arcadia/ui'
import { BookOutlined, ClockCircleOutlined, DeleteOutlined, DownloadOutlined, EditOutlined, FileTextOutlined, FolderOpenOutlined, FolderOutlined, GlobalOutlined, PlusOutlined, ReloadOutlined, RightOutlined, SearchOutlined, StarOutlined, UploadOutlined } from '@arcadia/ui/icons'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { DocumentCard } from '../../features/documents/DocumentCard'
import { DocumentDetailDrawer } from '../../features/documents/DocumentDetailDrawer'
import { loadDocuments } from '../../features/documents/documentService'
import {
  clearBrowserHistory,
  createCollection,
  deleteArchivedTab,
  deleteBrowserHistory,
  deleteClip,
  deleteCollection,
  listArchivedTabs,
  listBrowserHistory,
  listClips,
  listCollections,
  listReadingQueue,
  removeFromReadingQueue,
  saveClip,
  saveDocument,
  toggleStarred,
  type ArchivedTab,
  type Clip,
  type Collection,
  type ReadingQueueEntry,
} from '../../api'
import { listBookmarks, removeBookmark, updateBookmark, type BookmarkRecord } from '../../services/bookmarks'
import type { HistoryEntry } from '../../features/history/dedupeHistory'
import { HISTORY_CHANGE_EVENT } from '../../features/history/dedupeHistory'
import { formatArchivedAt, groupArchivedTabs } from '../../features/archive/archive'
import {
  AUTO_ARCHIVE_HOUR_OPTIONS,
  AUTO_ARCHIVE_RETENTION_OPTIONS,
  readAutoArchiveSettings,
  writeAutoArchiveSettings,
  type AutoArchiveSettings,
} from '../../features/archive/archiveSettings'
import { formatQueuedAt, queueHost } from '../../features/reading-queue/readingQueue'
import { documentInScope } from '@arcadia/browser-core/spaces'
import { useSpaceCollectionFilter } from '../../features/browser/spaceScope'
import { BookmarkImportDialog } from '../../features/import/BookmarkImportDialog'
import { CLIP_KIND_LABEL, clipPreview, clipSourceHost, clipToMarkdown, clipsToMarkdown } from '../../features/clips/clips'
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
  const spaceScope = useSpaceCollectionFilter()
  const [bookmarkImportOpen, setBookmarkImportOpen] = useState(false)
  const [collections, setCollections] = useState<Collection[]>([])
  const [selected, setSelected] = useState<Document | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [bookmarks, setBookmarks] = useState<BookmarkRecord[]>([])
  const [editingBookmark, setEditingBookmark] = useState<BookmarkRecord | null>(null)
  const [bookmarkDraft, setBookmarkDraft] = useState({ title: '', folder: '', note: '' })
  const [archived, setArchived] = useState<ArchivedTab[]>([])
  const [queue, setQueue] = useState<ReadingQueueEntry[]>([])
  const [clips, setClips] = useState<Clip[]>([])
  const [clipFilter, setClipFilter] = useState('')
  const [autoArchive, setAutoArchive] = useState<AutoArchiveSettings>(readAutoArchiveSettings)
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
        listReadingQueue().then(setQueue),
        listClips().then(setClips),
        listBookmarks().then(setBookmarks),
        downloadCenter.refresh(),
      ])
      messageApi.success(t("知识库已刷新"))
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message :t("刷新失败"))
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    void reloadDocuments()
    void listBrowserHistory().then(setHistory)
    void listArchivedTabs().then(setArchived)
    void listReadingQueue().then(setQueue)
    void listClips().then(setClips)
    void listBookmarks().then(setBookmarks)
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
      messageApi.success(next ?t("已收藏"):t("已取消收藏"))
    } catch (error) {
      setDocuments(previous)
      messageApi.error(error instanceof Error ? error.message :t("收藏状态更新失败"))
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
      messageApi.success(t("集合已创建"))
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message :t("创建集合失败"))
    }
  }

  async function removeCollection(collection: Collection) {
    try {
      await deleteCollection(collection.id)
      await refreshCollections()
      messageApi.success(t("集合已删除"))
    } catch {
      messageApi.error(t("删除集合失败"))
    }
  }

  async function importMarkdown(file: File) {
    if (!/\.(md|markdown|txt)$/i.test(file.name)) {
      messageApi.error(t("请选择 .md、.markdown 或 .txt 文件"))
      return false
    }
    const markdown = await file.text()
    if (!markdown.trim()) {
      messageApi.error(t("文件内容为空"))
      return false
    }
    setImporting(true)
    try {
      const title = file.name.replace(/\.[^.]+$/, '') ||t("未命名文档")
      const saved = await saveDocument({
        title,
        url: `file:///${encodeURIComponent(file.name)}`,
        markdown,
        tags: [t("导入")],
      })
      if (!saved) throw new Error(t("本地数据服务未返回文档"))
      setDocuments(items => [saved, ...items])
      setTab('documents')
      setAddOpen(false)
      messageApi.success(t("已导入「{value0}」",{value0:title}))
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message :t("导入失败"))
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

  async function removeHistoryEntry(entry: HistoryEntry) {
    try {
      await deleteBrowserHistory(entry.url)
      const next = history.filter(item => item.url !== entry.url)
      setHistory(next)
      window.dispatchEvent(new CustomEvent(HISTORY_CHANGE_EVENT, { detail: next }))
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : t("删除浏览记录失败"))
    }
  }

  async function clearAllHistory() {
    try {
      const removed = await clearBrowserHistory()
      setHistory([])
      window.dispatchEvent(new CustomEvent(HISTORY_CHANGE_EVENT, { detail: [] }))
      messageApi.success(t("已清空 {value0} 条浏览记录", { value0: removed }))
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : t("清空浏览记录失败"))
    }
  }

  function openArchived(entry: ArchivedTab) {
    window.dispatchEvent(new CustomEvent('arcadia-browser-open-url', { detail: { url: entry.url } }))
    onOpenBrowser?.()
  }

  async function removeArchived(id: string) {
    try {
      await deleteArchivedTab(id)
      setArchived(items => items.filter(item => item.id !== id))
      messageApi.success(t("已删除归档"))
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message :t("删除归档失败"))
    }
  }

  function openQueued(entry: ReadingQueueEntry) {
    window.dispatchEvent(new CustomEvent('arcadia-browser-open-url', { detail: { url: entry.url } }))
    onOpenBrowser?.()
  }

  async function removeQueued(id: string) {
    try {
      await removeFromReadingQueue(id)
      setQueue(items => items.filter(item => item.id !== id))
      messageApi.success(t("已移出待读"))
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : t("移出待读失败"))
    }
  }

  function updateAutoArchive(next: AutoArchiveSettings) {
    setAutoArchive(next)
    writeAutoArchiveSettings(next)
  }

  function openBookmark(bookmark: BookmarkRecord) {
    window.dispatchEvent(new CustomEvent('arcadia-browser-open-url', { detail: { url: bookmark.url } }))
    onOpenBrowser?.()
  }

  function beginBookmarkEdit(bookmark: BookmarkRecord) {
    setEditingBookmark(bookmark)
    setBookmarkDraft({ title: bookmark.title, folder: bookmark.folder, note: bookmark.note })
  }

  async function removeBookmarkEntry(bookmark: BookmarkRecord) {
    try {
      await removeBookmark(bookmark.id)
      setBookmarks(items => items.filter(item => item.id !== bookmark.id))
      messageApi.success(t("已删除收藏"))
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : t("删除收藏失败"))
    }
  }

  function openClip(clip: Clip) {
    window.dispatchEvent(new CustomEvent('arcadia-browser-open-url', { detail: { url: clip.sourceUrl } }))
    onOpenBrowser?.()
  }

  async function removeClip(clip: Clip) {
    try {
      await deleteClip(clip.id)
      setClips(items => items.filter(item => item.id !== clip.id))
      messageApi.success(t("已删除剪藏"))
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : t("删除剪藏失败"))
    }
  }

  async function assignClipCollection(clip: Clip, collectionId: string) {
    const next: Clip = { ...clip, collectionId: collectionId || null, updatedAt: Date.now() }
    try {
      await saveClip(next)
      setClips(items => items.map(item => item.id === clip.id ? next : item))
      messageApi.success(t("已归入集合"))
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : t("归入集合失败"))
    }
  }

  function downloadMarkdown(fileName: string, markdown: string) {
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fileName
    anchor.click()
    URL.revokeObjectURL(url)
  }

  function exportClip(clip: Clip) {
    const name = (clip.title || clipPreview(clip, 40)).replace(/[\\/:*?"<>|]/g, '_')
    downloadMarkdown(`${name}.md`, clipToMarkdown(clip))
  }

  async function saveBookmarkEdit() {    if (!editingBookmark) return
    const title = bookmarkDraft.title.trim()
    if (!title) {
      messageApi.error(t("收藏标题不能为空"))
      return
    }
    try {
      const updated = await updateBookmark(editingBookmark.id, {
        title,
        folder: bookmarkDraft.folder.trim(),
        note: bookmarkDraft.note,
      })
      setBookmarks(items => items.map(item => item.id === updated.id ? updated : item))
      setEditingBookmark(null)
      messageApi.success(t("收藏已更新"))
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : t("更新收藏失败"))
    }
  }

  const visibleDocuments = useMemo(() => {
    const scoped = documents.filter(document => documentInScope(spaceScope, document.id))
    const needle = query.trim().toLowerCase()
    const filtered = needle
      ? scoped.filter(document => [document.title, document.source, document.url, document.summary, ...document.tags]
        .filter(Boolean)
        .some(value => String(value).toLowerCase().includes(needle)))
      : scoped
    return [...filtered].sort((left, right) => {
      if (sort === 'title') return left.title.localeCompare(right.title, 'zh-CN')
      if (sort === 'words') return right.wordCount - left.wordCount
      return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    })
  }, [documents, query, sort, spaceScope])

  const starredCount = documents.filter(item => item.starred && documentInScope(spaceScope, item.id)).length
  const recentHistory = history.slice(0, 8)
  const archiveSections = groupArchivedTabs(archived)

  const documentsContent = <div className="library-module">
    <div className="library-section-head">
      <div>
        <h2>{query ?t("搜索结果"):t("最近保存")}</h2>
        <p>{query ?t("标题、来源或标签中包含\u201C{value0}\u201D的内容",{value0:query}):t("已沉淀到本地知识库的内容，按保存时间排列。")}</p>
      </div>
      {documents.length > 0 && <div className="library-section-head__tools">
        <span className="library-result-count">{visibleDocuments.length} {t("篇")}</span>
        <Segmented
          size="small"
          value={sort}
          onChange={value => setSort(value as SortMode)}
          options={[
            { label:t("最近"),value:'recent'},
            { label:t("标题"),value:'title'},
            { label:t("字数"),value:'words'},
          ]}
        />
      </div>}
    </div>
    {!loaded
      ? <Skeleton active/>
      : unavailable
        ? <div className="library-empty-state">
            <span className="library-empty-state__icon"><BookOutlined/></span>
            <h3>{t("本地数据库暂时不可用")}</h3>
            <p>{t("读取本机 knowledge.db 失败。内容都在这台机器上，不需要连接任何服务；可以先重试，若反复失败请附上下方的错误信息。")}</p>
            {loadError && <code className="library-empty-state__detail" title={loadError}>{loadError}</code>}
            <div className="library-empty-state__actions">
              <Button type="primary" onClick={() => void reloadDocuments()}>{t("重试")}</Button>
            </div>
          </div>
        : documents.length === 0
          ? <div className="library-empty-state">
              <span className="library-empty-state__icon"><BookOutlined/></span>
              <h3>{t("知识库还很安静")}</h3>
              <p>{t("浏览网页时点击工具栏的「保存到知识库」，正文、标题和来源会自动归档到这里。")}</p>
              <div className="library-empty-state__actions">
                <Button type="primary" icon={<PlusOutlined/>} onClick={() => setAddOpen(true)}>{t("添加文档")}</Button>
                {onOpenBrowser && <Button onClick={openBrowser}>{t("去浏览器逛逛")}</Button>}
              </div>
            </div>
          : !query && spaceScope && visibleDocuments.length === 0
            ? <div className="library-no-results">
                <SearchOutlined/>
                <h3>{t("当前 Space 范围内没有文档")}</h3>
                <p>{t("在左侧 Space 菜单的「知识范围」里切回全部知识库，或把文档加入该集合。")}</p>
              </div>
          : visibleDocuments.length === 0
            ? <div className="library-no-results">
                <SearchOutlined/>
                <h3>{t("没有找到匹配的文档")}</h3>
                <p>{t("换个关键词，或者清除搜索查看全部内容。")}</p>
                <Button type="text" onClick={() => setQuery('')}>{t("清除搜索")}</Button>
              </div>
            : <div className="library-document-grid">
                {visibleDocuments.map(document => <DocumentCard key={document.id} document={document} onOpen={setSelected} onToggleStarred={toggleStar} onArchived={handleArchived} onDeleted={handleDeleted} onChanged={refreshCollections}/>)}
                {!query && visibleDocuments.length < 3 && <button type="button" className="library-add-tile" onClick={() => setAddOpen(true)}>
                  <span className="library-add-tile__icon"><PlusOutlined/></span>
                  <strong>{t("添加下一篇")}</strong>
                  <small>{t("从浏览器保存，或导入本地 Markdown")}</small>
                </button>}
              </div>}
  </div>

  const collectionContent = <div className="library-module">
    <div className="library-section-head">
      <div>
        <h2>{t("集合")}</h2>
        <p>{t("按主题整理保存的网页和笔记。")}</p>
      </div>
      <Button icon={<PlusOutlined/>} onClick={() => setCreating(true)}>{t("新建集合")}</Button>
    </div>
    {collections.length === 0
      ? <div className="library-empty-state library-empty-state--compact">
          <span className="library-empty-state__icon"><FolderOpenOutlined/></span>
          <h3>{t("还没有集合")}</h3>
          <p>{t("把同一主题的文档收进一个集合，之后可以整组检索与回顾。")}</p>
          <Button icon={<PlusOutlined/>} onClick={() => setCreating(true)}>{t("新建集合")}</Button>
        </div>
      : <div className="library-collection-grid">
          {collections.map(collection => <article className="library-collection" key={collection.id}>
            <div className="library-collection__head">
              <span className="library-collection__icon"><FolderOutlined/></span>
              <Tag>{collection.documentCount} {t("篇")}</Tag>
            </div>
            <h3>{collection.name}</h3>
            <p>{collection.description ||t("还没有添加描述。")}</p>
            <div className="library-collection__footer">
              <span>{new Date(collection.createdAt).toLocaleDateString('zh-CN')} {t("创建")}</span>
              <Button danger type="text" size="small" icon={<DeleteOutlined/>} onClick={() => void removeCollection(collection)}>{t("删除")}</Button>
            </div>
          </article>)}
        </div>}
  </div>

  const historyContent = <div className="library-module">
    <div className="library-section-head">
      <div>
        <h2>{t("近期浏览")}</h2>
        <p>{t("最近访问过的网页，点击即可在浏览器中重新打开。")}</p>
      </div>
      <div className="library-section-head__tools">
        <span className="library-result-count">{recentHistory.length} {t("条")}</span>
        {history.length > 0 && <Popconfirm
          title={t("清空浏览记录？")}
          description={t("会同时删除本地数据库中的历史记录，且无法撤销。")}
          okText={t("清空")}
          cancelText={t("取消")}
          okButtonProps={{ danger: true }}
          onConfirm={() => void clearAllHistory()}
        ><Button danger size="small">{t("清空")}</Button></Popconfirm>}
      </div>
    </div>
    {recentHistory.length === 0
      ? <div className="library-empty-state library-empty-state--compact">
          <span className="library-empty-state__icon"><ClockCircleOutlined/></span>
          <h3>{t("暂无浏览记录")}</h3>
          <p>{t("浏览过的页面会按时间倒序出现在这里。")}</p>
        </div>
      : <div className="library-activity-list">
          {recentHistory.map(item => <div className="library-archive-row" key={item.url + item.visitedAt}>
            <button type="button" className="library-activity" onClick={() => openHistoryEntry(item)}>
              <span className="library-activity__icon"><GlobalOutlined/></span>
              <span className="library-activity__body">
                <strong title={item.title || item.url}>{item.title || item.url}</strong>
                <small><span>{hostOf(item.url) || item.url}</span><span>{formatWhen(item.visitedAt)}</span></small>
              </span>
              <RightOutlined className="library-activity__arrow"/>
            </button>
            <Button type="text" size="small" danger icon={<DeleteOutlined/>} aria-label={t("删除这条浏览记录")} onClick={() => void removeHistoryEntry(item)}/>
          </div>)}
        </div>}
  </div>

  const archiveContent = <div className="library-module">
    <div className="library-section-head">
      <div>
        <h2>{t("归档")}</h2>
        <p>{t("从标签栏收起但还没有保存的页面。可按标题或网址找回，也可以随时删除。")}</p>
      </div>
      <div className="library-section-head__tools library-archive-controls">
        <label className="library-archive-controls__toggle">
          <Switch checked={autoArchive.enabled} onChange={enabled => updateAutoArchive({ ...autoArchive, enabled })}/>
          <span>{t("自动归档")}</span>
        </label>
        <Select<number>
          className="library-archive-controls__idle"
          ariaLabel={t("自动归档空闲时长")}
          disabled={!autoArchive.enabled}
          options={AUTO_ARCHIVE_HOUR_OPTIONS.map(option => ({ label: t(option.label), value: option.value }))}
          value={autoArchive.idleHours}
          onChange={value => updateAutoArchive({ ...autoArchive, idleHours: Number(value) })}
        />
        <Select<number>
          className="library-archive-controls__idle"
          ariaLabel={t("归档保留上限")}
          options={AUTO_ARCHIVE_RETENTION_OPTIONS.map(option => ({ label: t(option.label), value: option.value }))}
          value={autoArchive.retention}
          onChange={value => updateAutoArchive({ ...autoArchive, retention: Number(value) })}
        />
        <span className="library-result-count">{archived.length} {t("条")}</span>
      </div>
    </div>
    {archived.length === 0
      ? <div className="library-empty-state library-empty-state--compact">
          <span className="library-empty-state__icon"><ClockCircleOutlined/></span>
          <h3>{t("还没有归档")}</h3>
          <p>{t("在标签页右键选择「归档标签页」，或从命令栏执行归档。归档不会删除页面，只是让它离开标签栏。")}</p>
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
            <Button type="text" size="small" danger icon={<DeleteOutlined/>} aria-label={t("删除归档")} onClick={()=>void removeArchived(item.id)}/>
          </div>)}
        </section>)}
  </div>

  const queueContent = <div className="library-module">
    <div className="library-section-head">
      <div>
        <h2>{t("待读")}</h2>
        <p>{t("先收起来、之后再看的页面。读完可以保存到知识库，也可以直接移出。")}</p>
      </div>
      <span className="library-result-count">{queue.length} {t("条")}</span>
    </div>
    {queue.length === 0
      ? <div className="library-empty-state library-empty-state--compact">
          <span className="library-empty-state__icon"><ClockCircleOutlined/></span>
          <h3>{t("待读列表是空的")}</h3>
          <p>{t("在浏览器里右键标签选择「稍后读」，或从命令栏执行；它只记链接，不占知识库。")}</p>
        </div>
      : <div className="library-activity-list">
          {queue.map(item => <div className="library-archive-row" key={item.id}>
            <button type="button" className="library-activity" onClick={() => openQueued(item)}>
              <span className="library-activity__icon"><ClockCircleOutlined/></span>
              <span className="library-activity__body">
                <strong title={item.title || item.url}>{item.title || item.url}</strong>
                <small><span>{queueHost(item.url)}</span><span>{formatQueuedAt(item.addedAt)}</span></small>
              </span>
              <RightOutlined className="library-activity__arrow"/>
            </button>
            <Button type="text" size="small" danger icon={<DeleteOutlined/>} aria-label={t("移出待读")} onClick={() => void removeQueued(item.id)}/>
          </div>)}
        </div>}
  </div>

  const bookmarkContent = <div className="library-module">
    <div className="library-section-head">
      <div>
        <h2>{t("收藏")}</h2>
        <p>{t("浏览器收藏的页面。可在这里打开、改名或删除。")}</p>
      </div>
      <div className="library-section-head__tools">
        <Button onClick={() => setBookmarkImportOpen(true)}>{t("导入书签")}</Button>
        <span className="library-result-count">{bookmarks.length} {t("条")}</span>
      </div>
    </div>
    {bookmarks.length === 0
      ? <div className="library-empty-state library-empty-state--compact">
          <span className="library-empty-state__icon"><StarOutlined/></span>
          <h3>{t("还没有收藏")}</h3>
          <p>{t("在浏览器里按 Ctrl+D 收藏当前页，之后会出现在这里。")}</p>
        </div>
      : <div className="library-activity-list">
          {bookmarks.map(item => <div className="library-archive-row" key={item.id}>
            <button type="button" className="library-activity" onClick={() => openBookmark(item)}>
              <span className="library-activity__icon"><StarOutlined/></span>
              <span className="library-activity__body">
                <strong title={item.title || item.url}>{item.title || item.url}</strong>
                <small><span>{queueHost(item.url)}</span><span>{item.folder || t("未分类")}</span></small>
              </span>
              <RightOutlined className="library-activity__arrow"/>
            </button>
            <Button type="text" size="small" icon={<EditOutlined/>} aria-label={t("编辑收藏")} onClick={() => beginBookmarkEdit(item)}/>
            <Button type="text" size="small" danger icon={<DeleteOutlined/>} aria-label={t("删除收藏")} onClick={() => void removeBookmarkEntry(item)}/>
          </div>)}
        </div>}
  </div>

  const clipCollectionOf = (clip: Clip): string => (
    clip.collectionId && collections.some(collection => collection.id === clip.collectionId)
      ? clip.collectionId
      : ''
  )
  const visibleClips = clipFilter === ''
    ? clips
    : clipFilter === '__none__'
      ? clips.filter(clip => !clipCollectionOf(clip))
      : clips.filter(clip => clipCollectionOf(clip) === clipFilter)

  const clipContent = <div className="library-module">
    <div className="library-section-head">
      <div>
        <h2>{t("剪藏")}</h2>
        <p>{t("从网页里截下来的文字、链接和图片，保留来源，可直接跳回原文。")}</p>
      </div>
      <div className="library-section-head__tools">
        <Select<string>
          size="small"
          className="library-clip-filter"
          ariaLabel={t("按集合筛选剪藏")}
          value={clipFilter}
          options={[
            { label: t("全部集合"), value: '' },
            { label: t("未分类"), value: '__none__' },
            ...collections.map(collection => ({ label: collection.name, value: collection.id })),
          ]}
          onChange={value => setClipFilter(String(value))}
        />
        <span className="library-result-count">{visibleClips.length} {t("条")}</span>
        {visibleClips.length > 0 && <Button size="small" icon={<DownloadOutlined/>} onClick={() => downloadMarkdown('clips.md', clipsToMarkdown(visibleClips))}>{t("导出列表")}</Button>}
      </div>
    </div>
    {clips.length === 0
      ? <div className="library-empty-state library-empty-state--compact">
          <span className="library-empty-state__icon"><FileTextOutlined/></span>
          <h3>{t("还没有剪藏")}</h3>
          <p>{t("在网页里选中文字、右键链接或图片，选择「剪藏」即可收进这里。")}</p>
        </div>
      : visibleClips.length === 0
        ? <div className="library-no-results">
            <FileTextOutlined/>
            <h3>{t("这个集合下还没有剪藏")}</h3>
            <p>{t("换一个集合，或把已有剪藏归入这里。")}</p>
            <Button type="text" onClick={() => setClipFilter('')}>{t("查看全部")}</Button>
          </div>
        : <div className="library-activity-list">
            {visibleClips.map(clip => <div className="library-archive-row" key={clip.id}>
              <button type="button" className="library-activity" onClick={() => openClip(clip)}>
                <span className="library-activity__icon"><FileTextOutlined/></span>
                <span className="library-activity__body">
                  <strong title={clip.title || clip.content}>{clip.title || clipPreview(clip)}</strong>
                  <small><span>{CLIP_KIND_LABEL[clip.kind]}</span><span>{clipSourceHost(clip)}</span><span>{formatQueuedAt(clip.createdAt)}</span></small>
                </span>
                <RightOutlined className="library-activity__arrow"/>
              </button>
              <Select<string>
                size="small"
                className="library-clip-collection"
                ariaLabel={t("归入集合")}
                value={clipCollectionOf(clip)}
                options={[{ label: t("未分类"), value: '' }, ...collections.map(collection => ({ label: collection.name, value: collection.id }))]}
                onChange={value => void assignClipCollection(clip, String(value))}
              />
              <Button type="text" size="small" icon={<DownloadOutlined/>} aria-label={t("导出为 Markdown")} onClick={() => exportClip(clip)}/>
              <Button type="text" size="small" danger icon={<DeleteOutlined/>} aria-label={t("删除剪藏")} onClick={() => void removeClip(clip)}/>
            </div>)}
          </div>}
  </div>

  const downloadContent = <div className="library-module">
    <div className="library-section-head">
      <div>
        <h2>{t("下载记录")}</h2>
        <p>{t("浏览器下载的文件与本次会话导出的 Markdown，重启后仍会保留已完成的下载。")}</p>
      </div>
      <span className="library-result-count">{downloadCenter.records.length} {t("项")}</span>
    </div>
    {downloads.length > 0 && <div className="library-export-list">
      <div className="library-export-list__head"><span>{t("本次会话导出")}</span><small>{downloads.length} {t("份")}</small></div>
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
          <h1>{t("你的知识库")}</h1>
          <p>{t("保存的网页会在这里沉淀、组织并被重新发现。")}</p>
        </div>
        <div className="library-header__actions">
          <Input
            className="library-search"
            prefix={<SearchOutlined/>}
            placeholder={t("搜索标题、来源或标签")}
            value={query}
            allowClear
            onChange={event => {
              setQuery(event.target.value)
              if (event.target.value) setTab('documents')
            }}
          />
          <Button className="library-add-button" type="primary" icon={<PlusOutlined/>} onClick={() => setAddOpen(true)}>{t("添加文档")}</Button>
        </div>
      </header>

      <div className="library-page__body">
        <div className="library-overview" aria-label={t("知识库概览")}>
          <OverviewMetric icon={<BookOutlined/>} label={t("全部文档")} value={documents.length} hint={t("网页与笔记")}/>
          <OverviewMetric icon={<StarOutlined/>} label={t("收藏")} value={starredCount} hint={t("值得重读")}/>
          <OverviewMetric icon={<FolderOutlined/>} label={t("集合")} value={collections.length} hint={t("主题归档")}/>
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
              {refreshing ?t("刷新中"):t("刷新")}
            </Button>
          }
          items={[
            { key: 'documents', label: <TabLabel label={t("最近保存")} count={documents.length}/>,children:documentsContent},
            { key: 'collections', label: <TabLabel label={t("集合")} count={collections.length}/>,children:collectionContent},
            { key: 'history', label: <TabLabel label={t("近期浏览")} count={recentHistory.length}/>,children:historyContent},
            { key: 'archive', label: <TabLabel label={t("归档")} count={archived.length}/>,children:archiveContent},
            { key: 'queue', label: <TabLabel label={t("待读")} count={queue.length}/>, children: queueContent },
            { key: 'bookmarks', label: <TabLabel label={t("收藏")} count={bookmarks.length}/>, children: bookmarkContent },
            { key: 'clips', label: <TabLabel label={t("剪藏")} count={clips.length}/>, children: clipContent },
            { key: 'downloads', label: <TabLabel label={t("下载记录")} count={downloadCenter.records.length}/>,children:downloadContent},
          ]}
        />
      </div>
    </div>

    <Modal title={t("添加文档")} open={addOpen} onCancel={()=>setAddOpen(false)} footer={null} width={580} className="library-add-modal">
      <Typography.Paragraph className="library-add-intro">{t("把网页或本地 Markdown 沉淀到知识库，所有内容只保存在这台设备上。")}</Typography.Paragraph>
      <div className="library-add-actions">
        <button type="button" className="library-add-card" onClick={openBrowser}>
          <span className="library-add-card__icon"><GlobalOutlined/></span>
          <span className="library-add-card__body">
            <strong>{t("从浏览器保存")}</strong>
            <small>{t("浏览网页时点击工具栏的「保存到知识库」，正文、标题和来源会自动归档。")}</small>
          </span>
          <RightOutlined className="library-add-card__arrow"/>
        </button>
        <div className="library-add-drop">
          <Upload.Dragger accept=".md,.markdown,.txt" disabled={importing} beforeUpload={importMarkdown}>
            <strong>{importing ?t("正在导入\u2026"):t("导入 Markdown 文件")}</strong>
            <small>{t("拖入或点击选择 .md / .markdown / .txt 文件，导入后会自动排队生成标签与索引。")}</small>
          </Upload.Dragger>
        </div>
      </div>
      <div className="library-add-note"><UploadOutlined/> {t("导入不会修改原文件，也不会把内容上传到网络。")}</div>
    </Modal>

    <Modal title={t("新建集合")} open={creating} onCancel={()=>{setCreating(false);setNewName('')}} onOk={()=>void createNewCollection()} okText={t("创建")} cancelText={t("取消")}>
      <Input autoFocus placeholder={t("集合名称")} value={newName} onChange={event=>setNewName(event.target.value)} onPressEnter={()=>void createNewCollection()}/>
    </Modal>
    <Modal
      title={t("编辑收藏")}
      open={Boolean(editingBookmark)}
      onCancel={() => setEditingBookmark(null)}
      onOk={() => void saveBookmarkEdit()}
      okText={t("保存")}
      cancelText={t("取消")}
    >
      <div className="library-bookmark-form">
        <Input placeholder={t("标题")} value={bookmarkDraft.title} onChange={event => setBookmarkDraft({ ...bookmarkDraft, title: event.target.value })}/>
        <Input placeholder={t("文件夹（可选）")} value={bookmarkDraft.folder} onChange={event => setBookmarkDraft({ ...bookmarkDraft, folder: event.target.value })}/>
        <Input.TextArea placeholder={t("备注（可选）")} value={bookmarkDraft.note} autoSize={{ minRows: 2, maxRows: 4 }} onChange={event => setBookmarkDraft({ ...bookmarkDraft, note: event.target.value })}/>
      </div>
    </Modal>
    <BookmarkImportDialog
      open={bookmarkImportOpen}
      onClose={() => setBookmarkImportOpen(false)}
      existingUrls={new Set(bookmarks.map(bookmark => bookmark.url))}
      onImported={() => { void listBookmarks().then(setBookmarks) }}
    />
    <DocumentDetailDrawer document={selected} onClose={() => setSelected(null)} onDeleted={id => setDocuments(items => items.filter(item => item.id !== id))} onExported={onExported} onUpdated={handleDocumentUpdated}/>
  </section>
}
import '../../styles/library.scss'
