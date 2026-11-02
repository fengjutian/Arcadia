import { t } from '../../i18n'
import { Typography } from '../../components/ui'
import type { CSSProperties } from 'react'
import type { ReaderArticle } from '../reader/types'
import type { ReaderSiteStyle } from '../browser/siteReaderPrefs'
import { hideCssFor } from '../browser/siteReaderPrefs'

export function ReaderArticleView({ article, style }: { article: ReaderArticle; style?: ReaderSiteStyle | null }) {
  const cssVars: Record<string, string> = {}
  if (style?.fontSize) cssVars['--reading-font-size'] = `${style.fontSize}px`
  if (style?.width) cssVars['--reader-width'] = `${style.width}px`
  const hideCss = hideCssFor(style ?? null)
  return <article className="reader-document" data-reader-theme={style?.theme} style={cssVars as CSSProperties}>
    {hideCss && <style>{hideCss}</style>}
    <Typography.Text className="eyebrow">{t("阅读模式 \xB7")} {article.wordCount.toLocaleString()} {t("字词")}</Typography.Text>
    <Typography.Title>{article.title}</Typography.Title>
    {article.byline && <Typography.Text type="secondary">{article.byline}</Typography.Text>}
    <div className="reader-document__body" dangerouslySetInnerHTML={{ __html: article.contentHtml }} />
  </article>
}
