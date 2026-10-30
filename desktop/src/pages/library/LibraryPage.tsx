import { Button, Input, message, Modal, Segmented, Skeleton, Tabs, Tag, Typography, Upload } from '../../components/ui'
import { BookOutlined, ClockCircleOutlined, DeleteOutlined, FileTextOutlined, FolderOpenOutlined, FolderOutlined, GlobalOutlined, PlusOutlined, ReloadOutlined, RightOutlined, SearchOutlined, StarOutlined, UploadOutlined } from '../../components/ui/icons'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { DocumentCard } from '../../features/documents/DocumentCard'
import { DocumentDetailDrawer } from '../../features/documents/DocumentDetailDrawer'
import { loadDocuments } from '../../features/documents/documentService'
import {
  createCollection,
  deleteCollection,
  listBrowserHistory,
  listCollections,
  saveDocument,
  toggleStarred,
  type Collection,
} from '../../api'
import type { HistoryEntry } from '../../features/history/dedupeHistory'
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
        downloadCenter.refresh(),
      ])
      messageApi.success('知识库已刷新')
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '刷新失败')
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    void reloadDocuments()
    void listBrowserHistory().then(setHistory)
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
      messageApi.success(next ? '已收藏' : '已取消收藏')
    } catch (error) {
      setDocuments(previous)
      messageApi.error(error instanceof Error ? error.message : '收藏状态更新失败')
    }
  }

  async function handleArchived(document: Document) {
    setDocuments(items => items.map(item => item.id === document.id ? { ...item, status: 'ARCHIVED' } : item))
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
      messageApi.success('集合已创建')
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '创建集合失败')
    }
  }

  async function removeCollection(collection: Collection) {
    try {
      await deleteCollection(collection.id)
      await refreshCollections()
      messageApi.success('集合已删除')
    } catch {
      messageApi.error('删除集合失败')
    }
  }

  async function importMarkdown(file: File) {
    if (!/\.(md|markdown|txt)$/i.test(file.name)) {
      messageApi.error('请选择 .md、.markdown 或 .txt 文件')
      return false
    }
    const markdown = await file.text()
    if (!markdown.trim()) {
      messageApi.error('文件内容为空')
      return false
    }
    setImporting(true)
    try {
      const title = file.name.replace(/\.[^.]+$/, '') || '未命名文档'
      const saved = await saveDocument({
        title,
        url: `file:///${encodeURIComponent(file.name)}`,
        markdown,
        tags: ['导入'],
      })
      if (!saved) throw new Error('本地数据服务未返回文档')
      setDocuments(items => [saved, ...items])
      setTab('documents')
      setAddOpen(false)
      messageApi.success(`已导入「${title}」`)
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '导入失败')
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

  const documentsContent = <div className="library-module">
    <div className="library-section-head">
      <div>
        <h2>{query ? '搜索结果' : '最近保存'}</h2>
        <p>{query ? `标题、来源或标签中包含“${query}”的内容` : '已沉淀到本地知识库的内容，按保存时间排列。'}</p>
      </div>
      {documents.length > 0 && <div className="library-section-head__tools">
        <span className="library-result-count">{visibleDocuments.length} 篇</span>
        <Segmented
          size="small"
          value={sort}
          onChange={value => setSort(value as SortMode)}
          options={[
            { label: '最近', value: 'recent' },
            { label: '标题', value: 'title' },
            { label: '字数', value: 'words' },
          ]}
        />
      </div>}
    </div>
    {!loaded
      ? <Skeleton active/>
      : unavailable
        ? <div className="library-empty-state">
            <span className="library-empty-state__icon"><BookOutlined/></span>
            <h3>本地数据库暂时不可用</h3>
            <p>读取本机 knowledge.db 失败。内容都在这台机器上，不需要连接任何服务；可以先重试，若反复失败请附上下方的错误信息。</p>
            {loadError && <code className="library-empty-state__detail" title={loadError}>{loadError}</code>}
            <div className="library-empty-state__actions">
              <Button type="primary" onClick={() => void reloadDocuments()}>重试</Button>
            </div>
          </div>
        : documents.length === 0
          ? <div className="library-empty-state">
              <span className="library-empty-state__icon"><BookOutlined/></span>
              <h3>知识库还很安静</h3>
              <p>浏览网页时点击工具栏的「保存到知识库」，正文、标题和来源会自动归档到这里。</p>
              <div className="library-empty-state__actions">
                <Button type="primary" icon={<PlusOutlined/>} onClick={() => setAddOpen(true)}>添加文档</Button>
                {onOpenBrowser && <Button onClick={openBrowser}>去浏览器逛逛</Button>}
              </div>
            </div>
          : visibleDocuments.length === 0
            ? <div className="library-no-results">
                <SearchOutlined/>
                <h3>没有找到匹配的文档</h3>
                <p>换个关键词，或者清除搜索查看全部内容。</p>
                <Button type="text" onClick={() => setQuery('')}>清除搜索</Button>
              </div>
            : <div className="library-document-grid">
                {visibleDocuments.map(document => <DocumentCard key={document.id} document={document} onOpen={setSelected} onToggleStarred={toggleStar} onArchived={handleArchived} onChanged={refreshCollections}/>)}
                {!query && visibleDocuments.length < 3 && <button type="button" className="library-add-tile" onClick={() => setAddOpen(true)}>
                  <span className="library-add-tile__icon"><PlusOutlined/></span>
                  <strong>添加下一篇</strong>
                  <small>从浏览器保存，或导入本地 Markdown</small>
                </button>}
              </div>}
  </div>

  const collectionContent = <div className="library-module">
    <div className="library-section-head">
      <div>
        <h2>集合</h2>
        <p>按主题整理保存的网页和笔记。</p>
      </div>
      <Button icon={<PlusOutlined/>} onClick={() => setCreating(true)}>新建集合</Button>
    </div>
    {collections.length === 0
      ? <div className="library-empty-state library-empty-state--compact">
          <span className="library-empty-state__icon"><FolderOpenOutlined/></span>
          <h3>还没有集合</h3>
          <p>把同一主题的文档收进一个集合，之后可以整组检索与回顾。</p>
          <Button icon={<PlusOutlined/>} onClick={() => setCreating(true)}>新建集合</Button>
        </div>
      : <div className="library-collection-grid">
          {collections.map(collection => <article className="library-collection" key={collection.id}>
            <div className="library-collection__head">
              <span className="library-collection__icon"><FolderOutlined/></span>
              <Tag>{collection.documentCount} 篇</Tag>
            </div>
            <h3>{collection.name}</h3>
            <p>{collection.description || '还没有添加描述。'}</p>
            <div className="library-collection__footer">
              <span>{new Date(collection.createdAt).toLocaleDateString('zh-CN')} 创建</span>
              <Button danger type="text" size="small" icon={<DeleteOutlined/>} onClick={() => void removeCollection(collection)}>删除</Button>
            </div>
          </article>)}
        </div>}
  </div>

  const historyContent = <div className="library-module">
    <div className="library-section-head">
      <div>
        <h2>近期浏览</h2>
        <p>最近访问过的网页，点击即可在浏览器中重新打开。</p>
      </div>
      <span className="library-result-count">{recentHistory.length} 条</span>
    </div>
    {recentHistory.length === 0
      ? <div className="library-empty-state library-empty-state--compact">
          <span className="library-empty-state__icon"><ClockCircleOutlined/></span>
          <h3>暂无浏览记录</h3>
          <p>浏览过的页面会按时间倒序出现在这里。</p>
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

  const downloadContent = <div className="library-module">
    <div className="library-section-head">
      <div>
        <h2>下载记录</h2>
        <p>浏览器下载的文件与本次会话导出的 Markdown，重启后仍会保留已完成的下载。</p>
      </div>
      <span className="library-result-count">{downloadCenter.records.length} 项</span>
    </div>
    {downloads.length > 0 && <div className="library-export-list">
      <div className="library-export-list__head"><span>本次会话导出</span><small>{downloads.length} 份</small></div>
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
          <h1>你的知识库</h1>
          <p>保存的网页会在这里沉淀、组织并被重新发现。</p>
        </div>
        <div className="library-header__actions">
          <Input
            className="library-search"
            prefix={<SearchOutlined/>}
            placeholder="搜索标题、来源或标签"
            value={query}
            allowClear
            onChange={event => {
              setQuery(event.target.value)
              if (event.target.value) setTab('documents')
            }}
          />
          <Button className="library-add-button" type="primary" icon={<PlusOutlined/>} onClick={() => setAddOpen(true)}>添加文档</Button>
        </div>
      </header>

      <div className="library-page__body">
        <div className="library-overview" aria-label="知识库概览">
          <OverviewMetric icon={<BookOutlined/>} label="全部文档" value={documents.length} hint="网页与笔记"/>
          <OverviewMetric icon={<StarOutlined/>} label="收藏" value={starredCount} hint="值得重读"/>
          <OverviewMetric icon={<FolderOutlined/>} label="集合" value={collections.length} hint="主题归档"/>
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
              {refreshing ? '刷新中' : '刷新'}
            </Button>
          }
          items={[
            { key: 'documents', label: <TabLabel label="最近保存" count={documents.length}/>, children: documentsContent },
            { key: 'collections', label: <TabLabel label="集合" count={collections.length}/>, children: collectionContent },
            { key: 'history', label: <TabLabel label="近期浏览" count={recentHistory.length}/>, children: historyContent },
            { key: 'downloads', label: <TabLabel label="下载记录" count={downloadCenter.records.length}/>, children: downloadContent },
          ]}
        />
      </div>
    </div>

    <Modal title="添加文档" open={addOpen} onCancel={() => setAddOpen(false)} footer={null} width={580} className="library-add-modal">
      <Typography.Paragraph className="library-add-intro">把网页或本地 Markdown 沉淀到知识库，所有内容只保存在这台设备上。</Typography.Paragraph>
      <div className="library-add-actions">
        <button type="button" className="library-add-card" onClick={openBrowser}>
          <span className="library-add-card__icon"><GlobalOutlined/></span>
          <span className="library-add-card__body">
            <strong>从浏览器保存</strong>
            <small>浏览网页时点击工具栏的「保存到知识库」，正文、标题和来源会自动归档。</small>
          </span>
          <RightOutlined className="library-add-card__arrow"/>
        </button>
        <div className="library-add-drop">
          <Upload.Dragger accept=".md,.markdown,.txt" disabled={importing} beforeUpload={importMarkdown}>
            <strong>{importing ? '正在导入…' : '导入 Markdown 文件'}</strong>
            <small>拖入或点击选择 .md / .markdown / .txt 文件，导入后会自动排队生成标签与索引。</small>
          </Upload.Dragger>
        </div>
      </div>
      <div className="library-add-note"><UploadOutlined/> 导入不会修改原文件，也不会把内容上传到网络。</div>
    </Modal>

    <Modal title="新建集合" open={creating} onCancel={() => { setCreating(false); setNewName('') }} onOk={() => void createNewCollection()} okText="创建" cancelText="取消">
      <Input autoFocus placeholder="集合名称" value={newName} onChange={event => setNewName(event.target.value)} onPressEnter={() => void createNewCollection()}/>
    </Modal>
    <DocumentDetailDrawer document={selected} onClose={() => setSelected(null)} onDeleted={id => setDocuments(items => items.filter(item => item.id !== id))} onExported={onExported} onUpdated={handleDocumentUpdated}/>
  </section>
}
