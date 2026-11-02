import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useEffect, useRef } from 'react'
import { t } from '../../i18n'
import { Button, Descriptions, Drawer, Space, Typography } from '../../components/ui'
import { LinkOutlined } from '../../components/ui/icons'
import type { ArchivedTab, Clip, PageNote } from '../../api'
import type { Document } from '../../types'
import { diagnosticLog } from '../../shared/diagnostics'
import { formatArchivedAt } from '../archive/archive'
import { CLIP_KIND_LABEL, clipSourceHost } from '../clips/clips'
import { queueHost } from '../reading-queue/readingQueue'

/** Characters rendered before the reader has to ask for the full text. */
const DOCUMENT_PREVIEW_LIMIT = 12_000

/**
 * Lightweight reference preview ("Peek").
 *
 * Clicking a citation or a search hit used to open the full document drawer
 * (tags, delete, archive). Peek keeps the current context: it shows just enough
 * to decide whether to open the original, and offers the full view explicitly.
 */
export type PeekTarget =
  | { kind: 'note'; note: PageNote }
  | { kind: 'archive'; entry: ArchivedTab }
  | { kind: 'clip'; clip: Clip }
  | { kind: 'document'; document: Document }

export function PeekDrawer({
  target,
  onClose,
  onOpenUrl,
  onOpenFull,
}: {
  target: PeekTarget | null
  onClose: () => void
  onOpenUrl: (url: string) => void
  onOpenFull?: (target: PeekTarget) => void
}) {
  const targetKey = target
    ? target.kind === 'note' ? target.note.id
      : target.kind === 'archive' ? target.entry.id
        : target.kind === 'clip' ? target.clip.id
          : target.document.id
    : ''
  const openedAtRef = useRef<number | null>(null)

  // Measure "click → first paint" so the 300ms budget for Peek can be checked
  // from the diagnostic log instead of guessed at.
  useEffect(() => {
    if (!target) {
      openedAtRef.current = null
      return
    }
    openedAtRef.current = typeof performance !== 'undefined' ? performance.now() : null
    const frame = requestAnimationFrame(() => {
      if (openedAtRef.current === null) return
      diagnosticLog('peek.first-paint', 'info', {
        kind: target.kind,
        ms: Math.round(performance.now() - openedAtRef.current),
      })
      openedAtRef.current = null
    })
    return () => cancelAnimationFrame(frame)
    // The kind + id identify a peek; re-measuring on every parent render would
    // pollute the log.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey, target?.kind])

  const url = target
    ? target.kind === 'note' ? target.note.url
      : target.kind === 'archive' ? target.entry.url
        : target.kind === 'clip' ? target.clip.sourceUrl
          : target.document.url
    : ''
  const title = target
    ? target.kind === 'note' ? target.note.title
      : target.kind === 'archive' ? target.entry.title
        : target.kind === 'clip' ? (target.clip.title || target.clip.sourceTitle)
          : target.document.title
    : ''
  const markdown = target?.kind === 'document' ? target.document.markdown ?? '' : ''
  const preview = markdown.slice(0, DOCUMENT_PREVIEW_LIMIT)
  const truncated = markdown.length > preview.length

  return <Drawer
    className="peek-drawer"
    open={Boolean(target)}
    onClose={onClose}
    width="min(640px, 92vw)"
    title={title}
    extra={<Space size={6}>
      {onOpenFull && target && <Button onClick={() => onOpenFull(target)}>{t("查看全文")}</Button>}
      <Button type="primary" icon={<LinkOutlined/>} disabled={!url} onClick={() => { onClose(); onOpenUrl(url) }}>{t("打开原文")}</Button>
    </Space>}
  >
    {target?.kind === 'note' && <article className="peek">
      <blockquote className="peek__quote">{target.note.quote}</blockquote>
      {target.note.comment && <Typography.Paragraph className="peek__comment">{target.note.comment}</Typography.Paragraph>}
      <Descriptions size="small" column={1} items={[
        { key: 'source', label: t("来源"), children: queueHost(target.note.url) },
        { key: 'time', label: t("记录于"), children: new Date(target.note.createdAt).toLocaleString('zh-CN') },
      ]}/>
    </article>}

    {target?.kind === 'archive' && <article className="peek">
      <Typography.Paragraph type="secondary" copyable>{target.entry.url}</Typography.Paragraph>
      <Typography.Paragraph>{t("归档只保留标题与链接，正文需要打开原文查看。")}</Typography.Paragraph>
      <Descriptions size="small" column={1} items={[
        { key: 'time', label: t("归档于"), children: formatArchivedAt(target.entry.archivedAt) },
      ]}/>
    </article>}

    {target?.kind === 'clip' && <article className="peek">
      {target.clip.kind === 'image' || target.clip.kind === 'link'
        ? <Typography.Paragraph><a href={target.clip.content} target="_blank" rel="noreferrer">{target.clip.content}</a></Typography.Paragraph>
        : <blockquote className="peek__quote">{target.clip.content}</blockquote>}
      {target.clip.note && <Typography.Paragraph className="peek__comment">{target.clip.note}</Typography.Paragraph>}
      <Descriptions size="small" column={1} items={[
        { key: 'kind', label: t("类型"), children: CLIP_KIND_LABEL[target.clip.kind] },
        { key: 'source', label: t("来源"), children: clipSourceHost(target.clip) },
        { key: 'time', label: t("剪藏于"), children: new Date(target.clip.createdAt).toLocaleString('zh-CN') },
      ]}/>
    </article>}

    {target?.kind === 'document' && <article className="peek">
      <header className="peek__hero">
        <span className="peek__source">{target.document.source || t("网页")}</span>
        {target.document.summary && <Typography.Paragraph className="peek__summary">{target.document.summary}</Typography.Paragraph>}
      </header>
      <Descriptions size="small" column={2} items={[
        { key: 'words', label: t("字数"), children: target.document.wordCount.toLocaleString() },
        { key: 'url', label: 'URL', span: 2, children: <Typography.Text ellipsis={{ tooltip: target.document.url }}>{target.document.url}</Typography.Text> },
      ]}/>
      <div className="markdown-body peek__body">
        {markdown
          ? <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ img: ({ node: _node, ...props }) => <img {...props} loading="lazy" decoding="async"/> }}>{preview}</ReactMarkdown>
          : <Typography.Text type="secondary">{t("这篇文档没有可阅读的正文")}</Typography.Text>}
      </div>
      {truncated && <Typography.Text type="secondary" className="peek__truncated">{t("仅预览前段内容，完整正文请打开全文或原文。")}</Typography.Text>}
    </article>}
  </Drawer>
}
