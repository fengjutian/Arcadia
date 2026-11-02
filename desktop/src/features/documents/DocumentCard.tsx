import { t } from '../../i18n'
import { Button, Card, Dropdown, Input, message, Popconfirm, Popover, Space, Tag, Tooltip, Typography } from '../../components/ui'
import { ClockCircleOutlined, DeleteOutlined, FileTextOutlined, FolderAddOutlined, InboxOutlined, MoreOutlined, StarFilled, StarOutlined } from '../../components/ui/icons'
import { useEffect, useState, type MouseEvent } from 'react'
import type { Document } from '../../types'
import { addToCollection, archiveDocument, createCollection, deleteDocument, listCollections, type Collection } from '../../api'

function sourceName(document: Document) {
  if (document.source) return document.source
  try {
    const hostname = new URL(document.url).hostname.replace(/^www\./, '')
    if (hostname) return hostname
    return document.url.startsWith('file:') ?t("Markdown \u6587\u4EF6"):t("\u7F51\u9875\u6587\u6863")
  } catch {
    return document.url.startsWith('file:') ?t("Markdown \u6587\u4EF6"):t("\u7F51\u9875\u6587\u6863")
  }
}

function savedDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const monthAndDay =t("{value0}\u6708{value1}\u65E5",{value0:date.getMonth()+1,value1:date.getDate()})
  return date.getFullYear() === now.getFullYear() ? monthAndDay :t("{value0}\u5E74{value1}",{value0:date.getFullYear(),value1:monthAndDay})
}

function excerptOf(document: Document) {
  const raw = document.summary?.trim() || document.markdown?.trim() || ''
  const text = raw
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text ||t("\u6682\u65E0\u6458\u8981\uFF0C\u6253\u5F00\u6587\u6863\u67E5\u770B\u6B63\u6587\u3002")
}

export function DocumentCard({ document, onOpen, onToggleStarred, onArchived, onDeleted, onChanged }: { document: Document; onOpen?: (document: Document) => void; onToggleStarred?: (document: Document) => void; onArchived?: (document: Document) => void; onDeleted?: (document: Document) => void; onChanged?: () => void }) {
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
      messageApi.success(t("\u5DF2\u52A0\u5165\u96C6\u5408"))
      setPopoverOpen(false)
      onChanged?.()
    } catch {
      messageApi.error(t("\u52A0\u5165\u96C6\u5408\u5931\u8D25"))
    }
  }

  async function quickCreate() {
    const name = newCollection.trim()
    if (!name) return
    try {
      const created = await createCollection(name)
      await addToCollection(created.id, document.id)
      messageApi.success(t("\u5DF2\u521B\u5EFA\u96C6\u5408\u300C{value0}\u300D\u5E76\u52A0\u5165",{value0:created.name}))
      setNewCollection('')
      setPopoverOpen(false)
      onChanged?.()
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message :t("\u521B\u5EFA\u96C6\u5408\u5931\u8D25"))
    }
  }

  async function archive() {
    try {
      await archiveDocument(document.id)
      messageApi.success(t("\u5DF2\u5F52\u6863"))
      onArchived?.(document)
    } catch {
      messageApi.error(t("\u5F52\u6863\u5931\u8D25"))
    }
  }

  async function remove() {
    try {
      await deleteDocument(document.id)
      messageApi.success(t("\u6587\u6863\u5DF2\u5220\u9664"))
      onDeleted?.(document)
      onChanged?.()
    } catch {
      messageApi.error(t("\u5220\u9664\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5"))
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
      {document.status === 'ARCHIVED' && <Tag className="document-card__status">{t("\u5DF2\u5F52\u6863")}</Tag>}
    </div>
    {document.tags.length > 0 && <div className="document-card__tags">
      {document.tags.slice(0, 3).map(tag => <Tag className="document-tag" key={tag}>{tag}</Tag>)}
      {document.tags.length > 3 && <Tag className="document-tag">+{document.tags.length - 3}</Tag>}
    </div>}
    <Typography.Title level={4} title={document.title}>{document.title}</Typography.Title>
    <Typography.Paragraph className="document-card__excerpt" ellipsis={{ rows: 2 }}>{excerptOf(document)}</Typography.Paragraph>
    <div className="document-card__meta">
      <span className="document-card__meta-item"><ClockCircleOutlined/>{document.wordCount.toLocaleString()} {t("\u5B57")}</span>
      {savedDate(document.createdAt) && <span className="document-card__meta-item">{savedDate(document.createdAt)}</span>}
      <div className="document-card__tools">
        <Tooltip title={document.starred ?t("\u53D6\u6D88\u6536\u85CF"):t("\u6536\u85CF")}mouseEnterDelay={0.5}>
          <button type="button" className={`library-icon-button document-card__star${document.starred ? ' is-starred' : ''}`} onClick={event => { stop(event); onToggleStarred?.(document) }} aria-label={document.starred ?t("\u53D6\u6D88\u6536\u85CF"):t("\u6536\u85CF")}aria-pressed={document.starred}>
            {document.starred ? <StarFilled/> : <StarOutlined/>}
          </button>
        </Tooltip>
        <Popover
          trigger="click"
          open={popoverOpen}
          onOpenChange={setPopoverOpen}
          placement="topRight"
          content={<div className="document-card__join">
            <Typography.Text strong>{t("\u52A0\u5165\u96C6\u5408")}</Typography.Text>
            {collections.length === 0 && <Typography.Paragraph type="secondary">{t("\u8FD8\u6CA1\u6709\u96C6\u5408\u3002")}</Typography.Paragraph>}
            {collections.map(collection => <Button key={collection.id} type="text" block onClick={() => void join(collection.id)}>{collection.name} <Tag>{collection.documentCount}</Tag></Button>)}
            <Space.Compact style={{ width: '100%' }}>
              <Input placeholder={t("\u65B0\u5EFA\u96C6\u5408\u5E76\u52A0\u5165")}value={newCollection}onChange={event=>setNewCollection(event.target.value)}onPressEnter={()=>void quickCreate()}/>
              <Button type="primary" onClick={() => void quickCreate()}>{t("\u5EFA")}</Button>
            </Space.Compact>
          </div>}
        >
          <button type="button" className="library-icon-button" aria-label={t("\u52A0\u5165\u96C6\u5408")}><FolderAddOutlined/></button>
        </Popover>
        <Popconfirm
          title={t("\u5220\u9664\u8FD9\u7BC7\u6587\u6863\uFF1F")}
          description={t("\u8BE5\u64CD\u4F5C\u4F1A\u540C\u65F6\u5220\u9664\u5168\u6587\u7D22\u5F15\u548C\u6807\u7B7E\u5173\u8054\u3002")}
          okText={t("\u5220\u9664")}
          cancelText={t("\u53D6\u6D88")}
          okButtonProps={{ danger: true }}
          onConfirm={remove}
        >
          <button type="button" className="library-icon-button document-card__delete" aria-label={t("\u5220\u9664\uFF1A{value0}",{value0:document.title})}onClick={stop}><DeleteOutlined/></button>
        </Popconfirm>
        <Dropdown menu={{ items: [{ key: 'archive', label:t("\u5F52\u6863"),icon:<InboxOutlined/>,disabled:document.status==='ARCHIVED',onClick:()=>void archive()}]}} trigger={['click']}>
          <button type="button" className="library-icon-button" aria-label={t("\u66F4\u591A\u64CD\u4F5C")}><MoreOutlined/></button>
        </Dropdown>
      </div>
    </div>
  </Card></>
}