import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { t } from '../../i18n'
import { Button } from '../../components/ui'
import type { Document } from '../../types'

/** Markdown pane shown beside a live web page in split view. */
export function DocumentSplitPane({ document, onClose }: { document: Document; onClose: () => void }) {
  const markdown = document.markdown?.trim() || document.summary?.trim() || ''
  return <div className="split-document-pane">
    <header className="split-document-pane__head">
      <b title={document.title}>{document.title}</b>
      <Button size="small" type="text" onClick={onClose}>{t("关闭")}</Button>
    </header>
    <div className="split-document-pane__body markdown-body">
      {markdown
        ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
        : <p className="split-document-pane__empty">{t("这篇文档没有可阅读的正文")}</p>}
    </div>
  </div>
}
