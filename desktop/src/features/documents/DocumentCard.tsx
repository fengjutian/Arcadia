import { Button, Card, Dropdown, Input, message, Popover, Space, Tag, Tooltip, Typography } from '../../components/ui'
import { ClockCircleOutlined, FileTextOutlined, FolderAddOutlined, InboxOutlined, MoreOutlined, StarFilled, StarOutlined } from '../../components/ui/icons'
import { useEffect, useState, type MouseEvent } from 'react'
import type { Document } from '../../types'
import { addToCollection, archiveDocument, createCollection, listCollections, type Collection } from '../../api'

function sourceName(document: Document) {
  if (document.source) return document.source
  try {
    const hostname = new URL(document.url).hostname.replace(/^www\./, '')
    if (hostname) return hostname
    return document.url.startsWith('file:') ? 'Markdown 文件' : '网页文档'
  } catch {
    return document.url.startsWith('file:') ? 'Markdown 文件' : '网页文档'
  }
}

function savedDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const monthAndDay = `${date.getMonth() + 1}月${date.getDate()}日`
  return date.getFullYear() === now.getFullYear() ? monthAndDay : `${date.getFullYear()}年${monthAndDay}`
}

function excerptOf(document: Document) {
  const raw = document.summary?.trim() || document.markdown?.trim() || ''
  const text = raw
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text || '暂无摘要，打开文档查看正文。'
}

export function DocumentCard({ document, onOpen, onToggleStarred, onArchived, onChanged }: { document: Document; onOpen?: (document: Document) => void; onToggleStarred?: (document: Document) => void; onArchived?: (document: Document) => void; onChanged?: () => void }) {
  const stop = (event: MouseEvent) => event.stopPropagation()
  const [messageApi, messageContext] = message.useMessage()
  const [collections, setCollections] = useState<Collection[]>([])
  const [newCollection, setNewCollection] = useState('')
  const [popoverOpen, setPopoverOpen] = useState(false)

  useEffect(() => {
    if (!popoverOpen) return
    void listCollections().then(setCollections).catch(() => setCollections([]))
  }, [popoverOpen])

  async function join(collectionId: string) {
    try {
      await addToCollection(collectionId, document.id)
      messageApi.success('已加入集合')
      setPopoverOpen(false)
      onChanged?.()
    } catch {
      messageApi.error('加入集合失败')
    }
  }

  async function quickCreate() {
    const name = newCollection.trim()
    if (!name) return
    try {
      const created = await createCollection(name)
      await addToCollection(created.id, document.id)
      messageApi.success(`已创建集合「${created.name}」并加入`)
      setNewCollection('')
      setPopoverOpen(false)
      onChanged?.()
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '创建集合失败')
    }
  }

  async function archive() {
    try {
      await archiveDocument(document.id)
      messageApi.success('已归档')
      onArchived?.(document)
    } catch {
      messageApi.error('归档失败')
    }
  }

  // Older rows and malformed imports may predate these non-null fields.
  document.wordCount ??= 0
  document.tags ??= []

  return <>{messageContext}<Card hoverable onClick={event => {
    if ((event.target as HTMLElement).closest('button, a, [role="button"]')) return
    onOpen?.(document)
  }} className="document-card">
    <div className="document-card__top">
      <span className="document-card__source">
        <span className="document-card__source-icon"><FileTextOutlined/></span>
        <span className="document-card__source-name" title={document.url}>{sourceName(document)}</span>
      </span>
      {document.status === 'ARCHIVED' && <Tag className="document-card__status">已归档</Tag>}
    </div>
    {document.tags.length > 0 && <div className="document-card__tags">
      {document.tags.slice(0, 3).map(tag => <Tag className="document-tag" key={tag}>{tag}</Tag>)}
      {document.tags.length > 3 && <Tag className="document-tag">+{document.tags.length - 3}</Tag>}
    </div>}
    <Typography.Title level={4} title={document.title}>{document.title}</Typography.Title>
    <Typography.Paragraph className="document-card__excerpt" ellipsis={{ rows: 2 }}>{excerptOf(document)}</Typography.Paragraph>
    <div className="document-card__meta">
      <span className="document-card__meta-item"><ClockCircleOutlined/>{document.wordCount.toLocaleString()} 字</span>
      {savedDate(document.createdAt) && <span className="document-card__meta-item">{savedDate(document.createdAt)}</span>}
      <div className="document-card__tools">
        <Tooltip title={document.starred ? '取消收藏' : '收藏'} mouseEnterDelay={0.5}>
          <button type="button" className={`library-icon-button document-card__star${document.starred ? ' is-starred' : ''}`} onClick={event => { stop(event); onToggleStarred?.(document) }} aria-label={document.starred ? '取消收藏' : '收藏'} aria-pressed={document.starred}>
            {document.starred ? <StarFilled/> : <StarOutlined/>}
          </button>
        </Tooltip>
        <Popover
          trigger="click"
          open={popoverOpen}
          onOpenChange={setPopoverOpen}
          placement="topRight"
          content={<div className="document-card__join">
            <Typography.Text strong>加入集合</Typography.Text>
            {collections.length === 0 && <Typography.Paragraph type="secondary">还没有集合。</Typography.Paragraph>}
            {collections.map(collection => <Button key={collection.id} type="text" block onClick={() => void join(collection.id)}>{collection.name} <Tag>{collection.documentCount}</Tag></Button>)}
            <Space.Compact style={{ width: '100%' }}>
              <Input placeholder="新建集合并加入" value={newCollection} onChange={event => setNewCollection(event.target.value)} onPressEnter={() => void quickCreate()}/>
              <Button type="primary" onClick={() => void quickCreate()}>建</Button>
            </Space.Compact>
          </div>}
        >
          <button type="button" className="library-icon-button" aria-label="加入集合"><FolderAddOutlined/></button>
        </Popover>
        <Dropdown menu={{ items: [{ key: 'archive', label: '归档', icon: <InboxOutlined/>, disabled: document.status === 'ARCHIVED', onClick: () => void archive() }] }} trigger={['click']}>
          <button type="button" className="library-icon-button" aria-label="更多操作"><MoreOutlined/></button>
        </Dropdown>
      </div>
    </div>
  </Card></>
}
