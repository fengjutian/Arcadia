import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { t } from '../../i18n'
import { Button } from '../../components/ui'
import type { Document } from '../../types'

function Pane({ document }: { document: Document }) {
  const markdown = document.markdown?.trim() || document.summary?.trim() || ''
  return <div className="document-pair__pane">
    <header><b title={document.title}>{document.title}</b></header>
    <div className="document-pair__body markdown-body">
      {markdown
        ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
        : <p className="split-document-pane__empty">{t("这篇文档没有可阅读的正文")}</p>}
    </div>
  </div>
}

/** Two documents side by side, no web view involved. */
export function DocumentPairView({ left, right, onClose }: { left: Document; right: Document; onClose: () => void }) {
  return <div className="document-pair">
    <div className="document-pair__head">
      <span>{t("文档对比")}</span>
      <Button size="small" type="text" onClick={onClose}>{t("关闭")}</Button>
    </div>
    <div className="document-pair__grid">
      <Pane document={left}/>
      <Pane document={right}/>
    </div>
  </div>
}
