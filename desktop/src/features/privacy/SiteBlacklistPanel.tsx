import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Input,
  Modal,
  Popconfirm,
  Space,
  Statistic,
  Switch,
  Tag,
  Typography,
  message,
} from '../../components/ui'
import type { SiteBlacklistEntry, SiteBlacklistEvent, SiteBlacklistImportResult, SiteBlacklistSummary } from '../../api'
import {
  addBlockedSite,
  addBlockedSites,
  blacklistSummary,
  clearBlockedSites,
  getBlacklistEntries,
  getBlacklistSettings,
  listBlacklistEvents,
  refreshSiteBlacklist,
  removeBlockedSite,
  setBlockedSiteEnabled,
  subscribeSiteBlacklist,
  updateBlacklistSettings,
} from './siteBlacklist'

const EMPTY_SUMMARY: SiteBlacklistSummary = { total: 0, enabled: 0, hitTotal: 0, lastBlockedAt: null }

export function SiteBlacklistPanel() {
  const [messageApi, contextHolder] = message.useMessage()
  const desktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
  const [entries, setEntries] = useState<SiteBlacklistEntry[]>([])
  const [events, setEvents] = useState<SiteBlacklistEvent[]>([])
  const [summary, setSummary] = useState<SiteBlacklistSummary>(EMPTY_SUMMARY)
  const [globalEnabled, setGlobalEnabled] = useState(true)
  const [blockSubresources, setBlockSubresources] = useState(true)
  const [input, setInput] = useState('')
  const [note, setNote] = useState('')
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [lastImport, setLastImport] = useState<SiteBlacklistImportResult | null>(null)

  const reload = useCallback(async () => {
    await refreshSiteBlacklist(true).catch(() => undefined)
    setEntries([...getBlacklistEntries()])
    const settings = getBlacklistSettings()
    setGlobalEnabled(settings.enabled)
    setBlockSubresources(settings.blockSubresources)
    const [nextSummary, nextEvents] = await Promise.all([
      blacklistSummary().catch(() => EMPTY_SUMMARY),
      listBlacklistEvents(20).catch(() => [] as SiteBlacklistEvent[]),
    ])
    setSummary(nextSummary)
    setEvents(nextEvents)
  }, [])

  useEffect(() => {
    let active = true
    void reload()
    let stop: () => void = () => undefined
    void subscribeSiteBlacklist(() => { if (active) void reload() }).then(unsubscribe => {
      if (active) stop = unsubscribe
      else unsubscribe()
    })
    return () => {
      active = false
      stop()
    }
  }, [reload])

  const filtered = useMemo(() => {
    const query = filter.trim().toLowerCase()
    return query ? entries.filter(entry => entry.host.includes(query)) : entries
  }, [entries, filter])

  async function handleAdd() {
    const value = input.trim()
    if (!value) return
    setBusy(true)
    try {
      const entry = await addBlockedSite(value, note.trim() || null, 'manual')
      setInput('')
      setNote('')
      await reload()
      messageApi.success(`已封杀 ${entry.host}`)
    } catch (error) {
      messageApi.error(String(error))
    } finally {
      setBusy(false)
    }
  }

  async function handleImport() {
    if (!importText.trim()) return
    setBusy(true)
    try {
      const result = await addBlockedSites(importText)
      setLastImport(result)
      await reload()
      messageApi.success(`新增 ${result.added.length} 个，重复 ${result.duplicates.length} 个，无效 ${result.invalid.length} 个`)
    } catch (error) {
      messageApi.error(String(error))
    } finally {
      setBusy(false)
    }
  }

  async function toggleGlobal(next: boolean) {
    setGlobalEnabled(next)
    try {
      await updateBlacklistSettings(next, blockSubresources)
      await reload()
      messageApi.success(next ? '已启用网站封杀' : '已关闭网站封杀')
    } catch (error) {
      setGlobalEnabled(!next)
      messageApi.error(String(error))
    }
  }

  async function toggleSubresources(next: boolean) {
    setBlockSubresources(next)
    try {
      await updateBlacklistSettings(globalEnabled, next)
      await reload()
      messageApi.success(next ? '已阻断被封杀站点的嵌入资源' : '已允许嵌入资源')
    } catch (error) {
      setBlockSubresources(!next)
      messageApi.error(String(error))
    }
  }

  async function toggleEntry(entry: SiteBlacklistEntry, next: boolean) {
    try {
      await setBlockedSiteEnabled(entry.id, next)
      await reload()
    } catch (error) {
      messageApi.error(String(error))
    }
  }

  async function removeEntry(entry: SiteBlacklistEntry) {
    try {
      await removeBlockedSite(entry.id)
      await reload()
      messageApi.success(`已解除封杀 ${entry.host}`)
    } catch (error) {
      messageApi.error(String(error))
    }
  }

  async function clearAll() {
    try {
      const removed = await clearBlockedSites()
      await reload()
      messageApi.success(`已清空 ${removed} 条封杀记录`)
    } catch (error) {
      messageApi.error(String(error))
    }
  }

  function exportList() {
    const text = entries
      .filter(entry => entry.enabled)
      .map(entry => (entry.includeSubdomains ? `*.${entry.host}` : entry.host))
      .join('\n')
    const blob = new Blob([text || ''], { type: 'text/plain;charset=utf-8' })
    const href = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = href
    link.download = 'site-blacklist.txt'
    link.click()
    URL.revokeObjectURL(href)
  }

  return <div className="privacy-section site-blacklist">
    {contextHolder}
    {!desktop && <Alert
      type="warning"
      showIcon
      message="网页预览模式无法修改封杀名单"
      description="网站封杀依赖 Tauri 原生层的请求拦截；请使用桌面应用（npm run tauri:dev）管理名单。"
    />}
    <Alert
      type="info"
      showIcon
      message="命中名单的网站不再加载"
      description="封杀在 Rust 端执行：顶级页面导航在发出请求前被取消，开关开启时站点内嵌的脚本、图片和 iframe 也会被阻断。名单只保存在本地。"
    />

    <div className="site-blacklist__switches">
      <label>
        <Switch checked={globalEnabled} disabled={!desktop} onChange={value => void toggleGlobal(value)} />
        <span>启用网站封杀</span>
      </label>
      <label>
        <Switch checked={blockSubresources} disabled={!desktop || !globalEnabled} onChange={value => void toggleSubresources(value)} />
        <span>阻断被封杀站点的嵌入资源</span>
      </label>
    </div>

    <div className="site-blacklist__add">
      <Input
        value={input}
        onChange={event => setInput(event.target.value)}
        onPressEnter={() => void handleAdd()}
        placeholder="输入域名或网址，例如 example.com"
        aria-label="要封杀的网站"
      />
      <Input
        value={note}
        onChange={event => setNote(event.target.value)}
        placeholder="备注（可选）"
        aria-label="封杀备注"
        maxLength={80}
      />
      <Button type="primary" disabled={!desktop || busy || !input.trim()} onClick={() => void handleAdd()}>添加</Button>
    </div>

    <Space wrap className="site-blacklist__toolbar">
      <Button disabled={!desktop} onClick={() => { setLastImport(null); setImportOpen(true) }}>批量导入</Button>
      <Button disabled={entries.length === 0} onClick={exportList}>导出名单</Button>
      <Popconfirm
        title={`清空全部 ${entries.length} 条封杀记录？`}
        description="所有网站会立即恢复访问，命中记录也会一并删除。"
        okText="清空"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        disabled={!desktop}
        onConfirm={() => void clearAll()}
      >
        <Button danger disabled={!desktop || entries.length === 0}>清空全部</Button>
      </Popconfirm>
    </Space>

    <div className="site-blacklist__stats">
      <Statistic title="封杀名单" value={summary.total} suffix="个" />
      <Statistic title="已启用" value={summary.enabled} suffix="个" />
      <Statistic title="累计命中" value={summary.hitTotal} suffix="次" />
      <Statistic
        title="最近命中"
        value={summary.lastBlockedAt ? new Date(summary.lastBlockedAt * 1000).toLocaleString() : '—'}
      />
    </div>

    <div className="site-blacklist__filter">
      <Input value={filter} onChange={event => setFilter(event.target.value)} placeholder="按主机名筛选" allowClear />
      <Typography.Text type="secondary">{filtered.length} / {entries.length} 条</Typography.Text>
    </div>

    {filtered.length === 0
      ? <Alert type="info" showIcon message={entries.length === 0 ? '还没有封杀任何网站' : '没有匹配的网站'} description={entries.length === 0 ? '在上方输入域名即可开始；也可以在浏览器菜单中选择「封杀此网站」。' : '换个关键词试试。'} />
      : <div className="site-blacklist__list" role="list">
          <div className="site-blacklist__row site-blacklist__row--header" aria-hidden="true">
            <span>网站</span><span>命中</span><span>最近命中</span><span>状态</span><span>操作</span>
          </div>
          {filtered.map(entry => <div className="site-blacklist__row" role="listitem" key={entry.id}>
            <span className="site-blacklist__host" title={entry.note ?? entry.host}>
              <b>{entry.host}</b>
              {!entry.includeSubdomains && <Tag>仅本站</Tag>}
              {entry.source !== 'manual' && <Tag color="default">{entry.source === 'import' ? '导入' : entry.source === 'quick-block' ? '快捷封杀' : entry.source}</Tag>}
            </span>
            <span>{entry.hitCount}</span>
            <span>{entry.lastBlockedAt ? new Date(entry.lastBlockedAt * 1000).toLocaleString() : '—'}</span>
            <span><Switch checked={entry.enabled} disabled={!desktop} onChange={value => void toggleEntry(entry, value)} /></span>
            <span>
              <Popconfirm
                title={`解除封杀 ${entry.host}？`}
                description="解除后该网站可以立即重新访问。"
                okText="解除"
                cancelText="取消"
                onConfirm={() => void removeEntry(entry)}
              >
                <Button size="small" danger>解除</Button>
              </Popconfirm>
            </span>
          </div>)}
        </div>}

    {events.length > 0 && <div className="site-blacklist__events">
      <Typography.Title level={5}>最近命中</Typography.Title>
      <Typography.Paragraph type="secondary">只记录顶级页面拦截，私密标签不写入。</Typography.Paragraph>
      <ul>
        {events.map(event => <li key={event.id}>
          <span>{new Date(event.blockedAt * 1000).toLocaleString()}</span>
          <span title={event.host}>{event.host}</span>
          <span title={event.url}>{event.url}</span>
        </li>)}
      </ul>
    </div>}

    <Modal
      open={importOpen}
      title="批量导入封杀名单"
      okText="开始导入"
      cancelText="关闭"
      okButtonProps={{ disabled: !desktop || busy || !importText.trim() }}
      onOk={() => void handleImport()}
      onCancel={() => setImportOpen(false)}
    >
      <Typography.Paragraph type="secondary">每行一个域名或网址，也支持逗号、分号分隔。路径会被忽略，只保留主机名。</Typography.Paragraph>
      <Input.TextArea
        rows={8}
        value={importText}
        onChange={event => setImportText(event.target.value)}
        placeholder={'example.com\nhttps://ads.example.net/path\n*.tracking.example.org'}
      />
      {lastImport && <div className="site-blacklist__import-result">
        <Typography.Text>新增 {lastImport.added.length} 个，重复 {lastImport.duplicates.length} 个，无效 {lastImport.invalid.length} 个</Typography.Text>
        {lastImport.invalid.length > 0 && <ul>
          {lastImport.invalid.slice(0, 8).map(item => <li key={item.input}>{item.input}：{item.reason}</li>)}
        </ul>}
      </div>}
    </Modal>
  </div>
}
