import { t } from '../../i18n'
import { Typography } from '../../components/ui'
import type { ReaderArticle } from '../reader/types'

export function ReaderArticleView({ article }: { article: ReaderArticle }) {
  return <article className="reader-document">
    <Typography.Text className="eyebrow">{t("\u9605\u8BFB\u6A21\u5F0F \xB7")} {article.wordCount.toLocaleString()} {t("\u5B57\u8BCD")}</Typography.Text>
    <Typography.Title>{article.title}</Typography.Title>
    {article.byline && <Typography.Text type="secondary">{article.byline}</Typography.Text>}
    <div className="reader-document__body" dangerouslySetInnerHTML={{ __html: article.contentHtml }} />
  </article>
}