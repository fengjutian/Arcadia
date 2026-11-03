import { useEffect, useState } from 'react'
import { t } from '@arcadia/i18n'
import { Alert, Button, Card, Space, Tag, Typography, message } from '../../components/ui'
import { StarOutlined, UploadOutlined } from '../../components/ui/icons'
import { listBookmarks, type BookmarkRecord } from '../../services/bookmarks'
import { BookmarkImportDialog } from '../import/BookmarkImportDialog'

/** Where the browser keeps "export my bookmarks", per product. */
const IMPORT_SOURCES = [
  { name: 'Google Chrome', hint: t("菜单 → 书签 → 书签管理器 → 导出书签") },
  { name: 'Microsoft Edge', hint: t("菜单 → 收藏夹 → 导出收藏夹") },
  { name: 'Arc / Dia', hint: t("导出书签 HTML 或标签清单 JSON") },
]

/**
 * Bookmark import entry point inside Settings. The dialog owns parsing and the
 * write loop (it previews new/duplicate counts first); this panel only supplies
 * the existing URLs used for de-duplication and refreshes the count afterwards.
 */
export function BookmarkImportSettings() {
  const [messageApi, contextHolder] = message.useMessage()
  const [bookmarks, setBookmarks] = useState<BookmarkRecord[]>([])
  const [countLoading, setCountLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setCountLoading(true)
    try {
      setBookmarks(await listBookmarks())
      setError('')
    } catch (caught) {
      setError(t("读取收藏失败：{value0}", { value0: String(caught) }))
    } finally {
      setCountLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleImported() {
    await load()
    messageApi.success(t("书签导入完成"))
  }

  return <>{contextHolder}<Card title={<Space><UploadOutlined/>{t("导入书签")}</Space>} className="settings-card bookmark-import-settings">
    <Typography.Paragraph type="secondary">{t("把其他浏览器导出的书签一次性搬进 Arcadia。文件只在本机解析，导入前会先统计新增与重复数量。")}</Typography.Paragraph>
    <div className="bookmark-import-sources">
      {IMPORT_SOURCES.map(source => <div key={source.name} className="bookmark-import-source">
        <strong>{source.name}</strong>
        <span>{source.hint}</span>
      </div>)}
      <div className="bookmark-import-source bookmark-import-source--count">
        <strong>{t("当前收藏")}</strong>
        <span>{countLoading ? t("读取中…") : t("{value0} 条", { value0: bookmarks.length })}</span>
        <Tag color="green">{t("仅本机")}</Tag>
      </div>
    </div>
    <Space wrap className="bookmark-import-actions">
      <Button type="primary" icon={<UploadOutlined/>} onClick={() => setDialogOpen(true)}>{t("选择书签文件")}</Button>
      <Button icon={<StarOutlined/>} onClick={() => window.dispatchEvent(new CustomEvent('arcadia-navigate-view', { detail: 'library' }))}>{t("打开收藏列表")}</Button>
      <Typography.Text type="secondary">{t("支持 .html / .htm / .json，可来自 Chrome、Edge、Arc 或 Dia。")}</Typography.Text>
    </Space>
    <Alert type="info" showIcon message={t("导入不会修改原文件")} description={t("书签按 URL 去重后写入本地数据库，也可以把这次导入同时保存为一个 Space。")}/>
    {error && <Typography.Text type="danger">{error}</Typography.Text>}
    <BookmarkImportDialog
      open={dialogOpen}
      onClose={() => setDialogOpen(false)}
      existingUrls={new Set(bookmarks.map(bookmark => bookmark.url))}
      onImported={() => void handleImported()}
    />
  </Card></>
}
