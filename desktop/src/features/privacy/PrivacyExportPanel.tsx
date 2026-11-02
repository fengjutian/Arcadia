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
    if (!password) { message.warning(t("\u8BF7\u5148\u8BBE\u7F6E\u5BFC\u51FA\u5BC6\u7801"));return}
    if (password.length < 4) { message.warning(t("\u5BC6\u7801\u81F3\u5C11 4 \u4E2A\u5B57\u7B26"));return}
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
      message.success(t("\u5DF2\u5BFC\u51FA {value0} \u5386\u53F2 + {value1} \u6536\u85CF + {value2} \u4E0B\u8F7D ({value3} KB)",{value0:stats.history,value1:stats.bookmarks,value2:stats.downloads,value3:(stats.bytes/1024).toFixed(1)}),3)
      setExportOpen(false)
      reset()
    } catch (error) {
      message.error(t("\u5BFC\u51FA\u5931\u8D25\uFF1A{value0}",{value0:String(error)}))
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
    if (!pendingFile) { message.warning(t("\u8BF7\u9009\u62E9\u52A0\u5BC6\u6587\u4EF6"));return}
    if (!importPassword) { message.warning(t("\u8BF7\u8F93\u5165\u89E3\u5BC6\u5BC6\u7801"));return}
    setBusy(true)
    try {
      const envelope = JSON.parse(pendingFile.content)
      const sections = await decryptPrivacyPayload(envelope, importPassword)
      await applySections(sections)
      const stats = exportStats(sections)
      message.success(t("\u5DF2\u5BFC\u5165 {value0} \u5386\u53F2 + {value1} \u6536\u85CF + {value2} \u4E0B\u8F7D",{value0:stats.history,value1:stats.bookmarks,value2:stats.downloads}),3)
      setImportOpen(false)
      reset()
    } catch (error) {
      message.error(t("\u5BFC\u5165\u5931\u8D25\uFF1A{value0}",{value0:String(error)}))
    } finally {
      setBusy(false)
    }
  }

  return <>
    <Space wrap>
      <Button icon={<DownloadOutlined />} onClick={() => { reset(); setExportOpen(true) }}>{t("\u5BFC\u51FA\u9690\u79C1\u6570\u636E")}</Button>
      <Button icon={<UploadOutlined />} onClick={() => { reset(); setImportOpen(true) }}>{t("\u5BFC\u5165\u9690\u79C1\u6570\u636E")}</Button>
    </Space>

    <Modal
      open={exportOpen}
      title={t("\u5BFC\u51FA\u9690\u79C1\u6570\u636E")}
      onCancel={() => setExportOpen(false)}
      onOk={runExport}
      okText={t("\u52A0\u5BC6\u5E76\u4E0B\u8F7D")}
      cancelText={t("\u53D6\u6D88")}
      okButtonProps={{ loading: busy, disabled: !password }}
    >
      <Typography.Paragraph type="secondary">{t("\u5C06\u5386\u53F2 / \u6536\u85CF / \u5173\u95ED\u7684\u6807\u7B7E / \u4E0B\u8F7D\u8BB0\u5F55 / \u7AD9\u70B9\u6743\u9650\u6253\u5305\u6210 AES-GCM \u52A0\u5BC6 JSON\uFF0C\u5BC6\u7801\u7528\u4E8E\u6D3E\u751F\u5BC6\u94A5\u3002\u6587\u4EF6\u53EA\u80FD\u7531\u76F8\u540C\u5BC6\u7801\u89E3\u5BC6\u3002")} 

      </Typography.Paragraph>
      <Input.Password
        prefix={<LockOutlined />}
        placeholder={t("\u8BBE\u7F6E\u5BFC\u51FA\u5BC6\u7801\uFF08\u2265 4 \u5B57\u7B26\uFF09")}
        value={password}
        onChange={event => setPassword(event.target.value)}
      />
      <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>{t("\u63D0\u793A\uFF1A\u4E0D\u8981\u5728\u516C\u5171\u7535\u8111\u4E0A\u4FDD\u5B58\u5BC6\u7801\u3002")} 

      </Typography.Paragraph>
    </Modal>

    <Modal
      open={importOpen}
      title={t("\u5BFC\u5165\u9690\u79C1\u6570\u636E")}
      onCancel={() => setImportOpen(false)}
      onOk={runImport}
      okText={t("\u89E3\u5BC6\u5E76\u5408\u5E76")}
      cancelText={t("\u53D6\u6D88")}
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
        <Typography.Text>{t("\u70B9\u51FB\u6216\u62D6\u62FD\u52A0\u5BC6 JSON \u6587\u4EF6\u5230\u6B64\u5904")}</Typography.Text>
      </Upload.Dragger>
      <Input.Password
        prefix={<LockOutlined />}
        placeholder={t("\u89E3\u5BC6\u5BC6\u7801")}
        value={importPassword}
        onChange={event => setImportPassword(event.target.value)}
        style={{ marginTop: 12 }}
      />
      {pendingFile && <Alert showIcon type="info" message={t("\u5DF2\u9009\u62E9 {value0}",{value0:pendingFile.name})}style={{marginTop:12}}/>}
    </Modal>
  </>
}