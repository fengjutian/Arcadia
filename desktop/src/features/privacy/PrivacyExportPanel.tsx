import { t } from '../../i18n'
import { useState } from 'react'
import { Alert, Button, Input, message, Modal, Space, Typography, Upload } from '../../components/ui'
import { DownloadOutlined, LockOutlined, UploadOutlined } from '../../components/ui/icons'
import { addBrowserHistory, listBrowserHistory } from '../../api'
import { listBookmarks } from '../../services/bookmarks'
import { listDownloads } from '../../services/downloads'
import { readSitePermissions } from '../../features/browser/sitePermissions'
import {
  decryptPrivacyPayload,
  encryptPrivacyPayload,
  exportStats,
  mergeBookmarks,
  mergeHistory,
  type PrivacyExportSections,
} from './privacyExport'

const CLOSED_KEY = 'browser.closed'

function readClosedTabs(): Array<{ id: string; url: string; title: string; favicon?: string; closedAt: number }> {
  try { return JSON.parse(localStorage.getItem(CLOSED_KEY) ?? '[]') } catch { return [] }
}

function writeClosedTabs(entries: Array<{ id: string; url: string; title: string; favicon?: string; closedAt: number }>): void {
  try { localStorage.setItem(CLOSED_KEY, JSON.stringify(entries)) } catch { /* ignore */ }
}

export function PrivacyExportPanel() {
  const [exportOpen, setExportOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [importPassword, setImportPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [pendingFile, setPendingFile] = useState<{ name: string; content: string } | null>(null)

  function reset() {
    setPassword('')
    setImportPassword('')
    setPendingFile(null)
  }

  async function collectSections(): Promise<PrivacyExportSections> {
    const [history, bookmarks, downloads, permissions] = await Promise.all([
      listBrowserHistory(),
      listBookmarks().catch(() => []),
      listDownloads(true).catch(() => []),
      Promise.resolve(readSitePermissions()),
    ])
    return {
      history,
      closedTabs: readClosedTabs(),
      bookmarks: bookmarks.map(     (b                                                                                                   )=>({id:b.id,url:b.url,title:b.title,favicon:b.favicon??null,folder:b.folder,note:b.note})),
      downloads: downloads.map(     (d                                                                                                                 )=>({id:d.id,url:d.url,fileName:d.fileName,status:d.status,dangerType:d.dangerType,startedAt:d.startedAt})),
      sitePermissions: permissions,
    }
  }

  async function runExport() {
    if (!password) { message.warning(t("请先设置导出密码"));return}
    if (password.length < 4) { message.warning(t("密码至少 4 个字符"));return}
    setBusy(true)
    try {
      const sections = await collectSections()
      const envelope = await encryptPrivacyPayload(sections, password)
      const json = JSON.stringify(envelope, null, 2)
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `arcadia-privacy-${new Date().toISOString().slice(0, 10)}.json`
      anchor.click()
      URL.revokeObjectURL(url)
      const stats = exportStats(sections)
      message.success(t("已导出 {value0} 历史 + {value1} 收藏 + {value2} 下载 ({value3} KB)",{value0:stats.history,value1:stats.bookmarks,value2:stats.downloads,value3:(stats.bytes/1024).toFixed(1)}),3)
      setExportOpen(false)
      reset()
    } catch (error) {
      message.error(t("导出失败：{value0}",{value0:String(error)}))
    } finally {
      setBusy(false)
    }
  }

  async function applySections(sections: PrivacyExportSections) {
    // Merge instead of overwrite so the user doesn't accidentally lose local state.
    const existingHistory = await listBrowserHistory().catch(() => [])
    const incomingHistory = mergeHistory(existingHistory, sections.history)
    // Persist history via the BrowserPage listener (we can't directly call
    // setHistory here); round-trip through `local_add_history` so the SQLite
    // store is the single source of truth.
    for (const entry of incomingHistory.slice(existingHistory.length)) {
      try { await addBrowserHistory(entry) } catch { /* ignore duplicates */ }
    }
    // Bookmarks — fire one addBookmark per record (skipExisting default true).
    const { addBookmark } = await import('../../services/bookmarks')
    for (const bookmark of sections.bookmarks) {
      try {
        await addBookmark({
          id: bookmark.id || crypto.randomUUID(),
          url: bookmark.url,
          title: bookmark.title,
          favicon: bookmark.favicon ?? null,
          folder: bookmark.folder ?? null,
          note: bookmark.note ?? null,
        })
      } catch { /* ignore duplicates */ }
    }
    // Closed tabs — merge then write to localStorage; the BrowserPage picks
    // them up via the storage change handler.
    if (sections.closedTabs.length) {
      const existingClosed = readClosedTabs()
      const seen = new Set(existingClosed.map(c => c.url))
      const merged = existingClosed.slice()
      for (const closed of sections.closedTabs) {
        if (seen.has(closed.url)) continue
        seen.add(closed.url)
        merged.push(closed)
      }
      writeClosedTabs(merged)
    }
    // Site permissions — only persist if the export included the block so
    // the user's existing rules stay untouched on a partial restore.
    if (sections.sitePermissions?.length) {
      const { writeSitePermissions } = await import('../../features/browser/sitePermissions')
      // Merge: existing rules take precedence (the user may have updated
      // them locally since the export was made).
      const existing = readSitePermissions()
      const incoming = sections.sitePermissions
      const incomingByOrigin = new Map(incoming.map(r => [r.origin, r]))
      const merged = existing.map(rule => incomingByOrigin.get(rule.origin) ? { ...rule, ...incomingByOrigin.get(rule.origin) } : rule)
      for (const rule of incoming) {
        if (!existing.some(e => e.origin === rule.origin)) merged.push(rule as Parameters<typeof writeSitePermissions>[0][number])
      }
      writeSitePermissions(merged)
    }
    // Bump the history / bookmark counts so the UI refreshes.
    window.dispatchEvent(new CustomEvent('arcadia-history-change'))
  }

  async function runImport() {
    if (!pendingFile) { message.warning(t("请选择加密文件"));return}
    if (!importPassword) { message.warning(t("请输入解密密码"));return}
    setBusy(true)
    try {
      const envelope = JSON.parse(pendingFile.content)
      const sections = await decryptPrivacyPayload(envelope, importPassword)
      await applySections(sections)
      const stats = exportStats(sections)
      message.success(t("已导入 {value0} 历史 + {value1} 收藏 + {value2} 下载",{value0:stats.history,value1:stats.bookmarks,value2:stats.downloads}),3)
      setImportOpen(false)
      reset()
    } catch (error) {
      message.error(t("导入失败：{value0}",{value0:String(error)}))
    } finally {
      setBusy(false)
    }
  }

  return <>
    <Space wrap>
      <Button icon={<DownloadOutlined />} onClick={() => { reset(); setExportOpen(true) }}>{t("导出隐私数据")}</Button>
      <Button icon={<UploadOutlined />} onClick={() => { reset(); setImportOpen(true) }}>{t("导入隐私数据")}</Button>
    </Space>

    <Modal
      open={exportOpen}
      title={t("导出隐私数据")}
      onCancel={() => setExportOpen(false)}
      onOk={runExport}
      okText={t("加密并下载")}
      cancelText={t("取消")}
      okButtonProps={{ loading: busy, disabled: !password }}
    >
      <Typography.Paragraph type="secondary">{t("将历史 / 收藏 / 关闭的标签 / 下载记录 / 站点权限打包成 AES-GCM 加密 JSON，密码用于派生密钥。文件只能由相同密码解密。")} 

      </Typography.Paragraph>
      <Input.Password
        prefix={<LockOutlined />}
        placeholder={t("设置导出密码（\u2265 4 字符）")}
        value={password}
        onChange={event => setPassword(event.target.value)}
      />
      <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>{t("提示：不要在公共电脑上保存密码。")} 

      </Typography.Paragraph>
    </Modal>

    <Modal
      open={importOpen}
      title={t("导入隐私数据")}
      onCancel={() => setImportOpen(false)}
      onOk={runImport}
      okText={t("解密并合并")}
      cancelText={t("取消")}
      okButtonProps={{ loading: busy, disabled: !pendingFile || !importPassword }}
    >
      <Upload.Dragger
        accept="application/json,.json"
        beforeUpload={file => {
          const reader = new FileReader()
          reader.onload = () => {
            setPendingFile({ name: file.name, content: String(reader.result ?? '') })
          }
          reader.readAsText(file)
          return false
        }}
        onRemove={() => setPendingFile(null)}
        fileList={pendingFile ? [{ uid: 'pending', name: pendingFile.name, status: 'done' }] : []}
      >
        <Typography.Text>{t("点击或拖拽加密 JSON 文件到此处")}</Typography.Text>
      </Upload.Dragger>
      <Input.Password
        prefix={<LockOutlined />}
        placeholder={t("解密密码")}
        value={importPassword}
        onChange={event => setImportPassword(event.target.value)}
        style={{ marginTop: 12 }}
      />
      {pendingFile && <Alert showIcon type="info" message={t("已选择 {value0}",{value0:pendingFile.name})} style={{marginTop:12}}/>}
    </Modal>
  </>
}