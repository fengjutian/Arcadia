import { useState } from 'react'
import { t } from '../../i18n'
import { Button, Input, Modal, Space, Switch, Typography } from '../../components/ui'
import { addBookmark, removeBookmark } from '../../services/bookmarks'
import { saveWorkspace } from '../../services/workspaces'
import { importToSpacePayload, parseBookmarksHtml, planBookmarkImport, type BookmarkImportPlan } from './bookmarksImport'

/**
 * Import a Netscape bookmark file exported by Arc / Chrome / Edge.
 *
 * Everything is previewed before writing: new vs duplicate counts, a sample of
 * titles, and an optional "also create a Space" switch. Writes happen one by
 * one and refresh the list only after the loop finishes.
 */
export function BookmarkImportDialog({ open, onClose, existingUrls, onImported }: {
  open: boolean
  onClose: () => void
  existingUrls: ReadonlySet<string>
  onImported: () => void
}) {
  const [plan, setPlan] = useState<BookmarkImportPlan | null>(null)
  const [fileName, setFileName] = useState('')
  const [asSpace, setAsSpace] = useState(false)
  const [spaceName, setSpaceName] = useState('')
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')

  function reset() {
    setPlan(null)
    setFileName('')
    setAsSpace(false)
    setSpaceName('')
    setError('')
    setImporting(false)
  }

  async function pick(file: File | null) {
    if (!file) return
    setError('')
    setFileName(file.name)
    try {
      const html = await file.text()
      const parsed = parseBookmarksHtml(html)
      const next = planBookmarkImport(parsed, existingUrls)
      setPlan(next)
      if (!spaceName) setSpaceName(file.name.replace(/\.html?$/i, ''))
      if (parsed.length === 0) setError(t("没有从文件中读到书签，请确认是浏览器导出的 HTML 文件。"))
    } catch {
      setPlan(null)
      setError(t("读取文件失败"))
    }
  }

  async function runImport() {
    if (!plan || plan.unique.length === 0 || importing) return
    setImporting(true)
    setError('')
    const written: string[] = []
    try {
      for (const bookmark of plan.unique) {
        const id = crypto.randomUUID()
        await addBookmark({
          id,
          url: bookmark.url,
          title: bookmark.title,
          folder: bookmark.folder ?? null,
        })
        written.push(id)
      }
      if (asSpace) {
        await saveWorkspace({
          name: (spaceName.trim() || t("导入的书签")).slice(0, 80),
          description: t("从书签文件导入"),
          payload: importToSpacePayload(plan.unique),
        })
      }
      onImported()
      reset()
      onClose()
    } catch (caught) {
      // The command layer has no cross-call transaction, so roll back what this
      // run already wrote; a failed import must not leave half a file behind.
      await Promise.all(written.map(id => removeBookmark(id).catch(() => undefined)))
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setImporting(false)
    }
  }

  return <Modal
    open={open}
    title={t("导入浏览器书签")}
    onCancel={() => { reset(); onClose() }}
    footer={[
      <Button key="cancel" onClick={() => { reset(); onClose() }}>{t("取消")}</Button>,
      <Button key="import" type="primary" loading={importing} disabled={!plan || plan.unique.length === 0} onClick={() => void runImport()}>{t("导入 {value0} 条", { value0: plan?.unique.length ?? 0 })}</Button>,
    ]}
  >
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        {t("支持 Arc / Chrome / Edge 等浏览器导出的书签 HTML。导入前会先显示新增与重复数量。")}
      </Typography.Paragraph>
      <input
        type="file"
        accept=".html,.htm,text/html"
        aria-label={t("选择书签文件")}
        onChange={event => { void pick(event.target.files?.[0] ?? null); event.target.value = '' }}
      />
      {fileName && <Typography.Text type="secondary">{fileName}</Typography.Text>}
      {plan && <Typography.Text>
        {t("新增 {value0} 条 · 重复 {value1} 条 · 跳过 {value2} 条", { value0: plan.unique.length, value1: plan.duplicates.length, value2: plan.skipped })}
      </Typography.Text>}
      {plan && plan.unique.length > 0 && <div className="bookmark-import-preview">
        {plan.unique.slice(0, 8).map(bookmark => <div key={bookmark.url} className="bookmark-import-preview__row">
          <span>{bookmark.title}</span>
          <small>{bookmark.folder ? `${bookmark.folder} · ` : ''}{bookmark.url}</small>
        </div>)}
        {plan.unique.length > 8 && <Typography.Text type="secondary">{t("还有 {value0} 条", { value0: plan.unique.length - 8 })}</Typography.Text>}
      </div>}
      <label className="bookmark-import-space">
        <Switch checked={asSpace} onChange={setAsSpace}/>
        <span>{t("同时保存为一个 Space")}</span>
      </label>
      {asSpace && <Input value={spaceName} onChange={event => setSpaceName(event.target.value)} placeholder={t("Space 名称")} maxLength={80}/>}
      {error && <Typography.Text type="danger">{error}</Typography.Text>}
    </Space>
  </Modal>
}
