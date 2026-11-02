import { t } from '../../i18n'
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
  setBlockedSiteScope,
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
  const [includeSubdomains, setIncludeSubdomains] = useState(true)
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
      const entry = await addBlockedSite(value, note.trim() || null, 'manual', includeSubdomains)
      setInput('')
      setNote('')
      await reload()
      messageApi.success(t("\u5DF2\u5C01\u6740 {value0}",{value0:entry.host}))
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
      messageApi.success(t("\u65B0\u589E {value0} \u4E2A\uFF0C\u91CD\u590D {value1} \u4E2A\uFF0C\u65E0\u6548 {value2} \u4E2A",{value0:result.added.length,value1:result.duplicates.length,value2:result.invalid.length}))
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
      messageApi.success(next ?t("\u5DF2\u542F\u7528\u7F51\u7AD9\u5C01\u6740"):t("\u5DF2\u5173\u95ED\u7F51\u7AD9\u5C01\u6740"))
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
      messageApi.success(next ?t("\u5DF2\u963B\u65AD\u88AB\u5C01\u6740\u7AD9\u70B9\u7684\u5D4C\u5165\u8D44\u6E90"):t("\u5DF2\u5141\u8BB8\u5D4C\u5165\u8D44\u6E90"))
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

  async function toggleScope(entry: SiteBlacklistEntry) {
    const next = !entry.includeSubdomains
    try {
      await setBlockedSiteScope(entry.id, next)
      await reload()
      messageApi.success(next ?t("{value0} \u73B0\u5728\u540C\u65F6\u5C01\u6740\u5B50\u57DF",{value0:entry.host}):t("{value0} \u73B0\u5728\u53EA\u5C01\u6740\u8BE5\u4E3B\u673A",{value0:entry.host}))
    } catch (error) {
      messageApi.error(String(error))
    }
  }

  async function removeEntry(entry: SiteBlacklistEntry) {
    try {
      await removeBlockedSite(entry.id)
      await reload()
      messageApi.success(t("\u5DF2\u89E3\u9664\u5C01\u6740 {value0}",{value0:entry.host}))
    } catch (error) {
      messageApi.error(String(error))
    }
  }

  async function clearAll() {
    try {
      const removed = await clearBlockedSites()
      await reload()
      messageApi.success(t("\u5DF2\u6E05\u7A7A {value0} \u6761\u5C01\u6740\u8BB0\u5F55",{value0:removed}))
    } catch (error) {
      messageApi.error(String(error))
    }
  }

  function exportList() {
    const text = entries
      .filter(entry => entry.enabled)
      .map(         (entry                                                   )=>(entry.includeSubdomains?`*.${entry.host}`:entry.host))
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
      message={t("\u7F51\u9875\u9884\u89C8\u6A21\u5F0F\u65E0\u6CD5\u4FEE\u6539\u5C01\u6740\u540D\u5355")}
      description={t("\u7F51\u7AD9\u5C01\u6740\u4F9D\u8D56 Tauri \u539F\u751F\u5C42\u7684\u8BF7\u6C42\u62E6\u622A\uFF1B\u8BF7\u4F7F\u7528\u684C\u9762\u5E94\u7528\uFF08npm run tauri:dev\uFF09\u7BA1\u7406\u540D\u5355\u3002")}
    />}
    <Alert
      type="info"
      showIcon
      message={t("\u547D\u4E2D\u540D\u5355\u7684\u7F51\u7AD9\u4E0D\u518D\u52A0\u8F7D")}
      description={t("\u5C01\u6740\u5728 Rust \u7AEF\u6267\u884C\uFF1A\u9876\u7EA7\u9875\u9762\u5BFC\u822A\u5728\u53D1\u51FA\u8BF7\u6C42\u524D\u88AB\u53D6\u6D88\uFF0C\u5F00\u5173\u5F00\u542F\u65F6\u7AD9\u70B9\u5185\u5D4C\u7684\u811A\u672C\u3001\u56FE\u7247\u548C iframe \u4E5F\u4F1A\u88AB\u963B\u65AD\u3002\u540D\u5355\u53EA\u4FDD\u5B58\u5728\u672C\u5730\u3002")}
    />

    <div className="site-blacklist__switches">
      <label>
        <Switch checked={globalEnabled} disabled={!desktop} onChange={value => void toggleGlobal(value)} />
        <span>{t("\u542F\u7528\u7F51\u7AD9\u5C01\u6740")}</span>
      </label>
      <label>
        <Switch checked={blockSubresources} disabled={!desktop || !globalEnabled} onChange={value => void toggleSubresources(value)} />
        <span>{t("\u963B\u65AD\u88AB\u5C01\u6740\u7AD9\u70B9\u7684\u5D4C\u5165\u8D44\u6E90")}</span>
      </label>
    </div>

    <div className="site-blacklist__add">
      <Input
        value={input}
        onChange={event => setInput(event.target.value)}
        onPressEnter={() => void handleAdd()}
        placeholder={t("\u8F93\u5165\u57DF\u540D\u6216\u7F51\u5740\uFF0C\u4F8B\u5982 example.com")}
        aria-label={t("\u8981\u5C01\u6740\u7684\u7F51\u7AD9")}
      />
      <Input
        value={note}
        onChange={event => setNote(event.target.value)}
        placeholder={t("\u5907\u6CE8\uFF08\u53EF\u9009\uFF09")}
        aria-label={t("\u5C01\u6740\u5907\u6CE8")}
        maxLength={80}
      />
      <Button type="primary" disabled={!desktop || busy || !input.trim()} onClick={() => void handleAdd()}>{t("\u6DFB\u52A0")}</Button>
    </div>
    <div className="site-blacklist__scope">
      <Switch checked={includeSubdomains} disabled={!desktop} onChange={setIncludeSubdomains} />
      <span>{t("\u540C\u65F6\u5C01\u6740\u5B50\u57DF\uFF08\u5982")} <code>news.example.com</code>{t("\uFF09\uFF1B\u5173\u95ED\u540E\u53EA\u5C01\u6740\u8BE5\u4E3B\u673A")}</span>
    </div>

    <Space wrap className="site-blacklist__toolbar">
      <Button disabled={!desktop} onClick={() => { setLastImport(null); setImportOpen(true) }}>{t("\u6279\u91CF\u5BFC\u5165")}</Button>
      <Button disabled={entries.length === 0} onClick={exportList}>{t("\u5BFC\u51FA\u540D\u5355")}</Button>
      <Popconfirm
        title={t("\u6E05\u7A7A\u5168\u90E8 {value0} \u6761\u5C01\u6740\u8BB0\u5F55\uFF1F",{value0:entries.length})}
        description={t("\u6240\u6709\u7F51\u7AD9\u4F1A\u7ACB\u5373\u6062\u590D\u8BBF\u95EE\uFF0C\u547D\u4E2D\u8BB0\u5F55\u4E5F\u4F1A\u4E00\u5E76\u5220\u9664\u3002")}
        okText={t("\u6E05\u7A7A")}
        cancelText={t("\u53D6\u6D88")}
        okButtonProps={{ danger: true }}
        disabled={!desktop}
        onConfirm={() => void clearAll()}
      >
        <Button danger disabled={!desktop || entries.length === 0}>{t("\u6E05\u7A7A\u5168\u90E8")}</Button>
      </Popconfirm>
    </Space>

    <div className="site-blacklist__stats">
      <Statistic title={t("\u5C01\u6740\u540D\u5355")}value={summary.total}suffix={t("\u4E2A")}/>
      <Statistic title={t("\u5DF2\u542F\u7528")}value={summary.enabled}suffix={t("\u4E2A")}/>
      <Statistic title={t("\u7D2F\u8BA1\u547D\u4E2D")}value={summary.hitTotal}suffix={t("\u6B21")}/>
      <Statistic
        title={t("\u6700\u8FD1\u547D\u4E2D")}
        value={summary.lastBlockedAt ? new Date(summary.lastBlockedAt * 1000).toLocaleString() : '—'}
      />
    </div>

    <div className="site-blacklist__filter">
      <Input value={filter} onChange={event => setFilter(event.target.value)} placeholder={t("\u6309\u4E3B\u673A\u540D\u7B5B\u9009")}allowClear/>
      <Typography.Text type="secondary">{filtered.length} / {entries.length} {t("\u6761")}</Typography.Text>
    </div>

    {filtered.length === 0
      ? <Alert type="info" showIcon message={entries.length === 0 ?t("\u8FD8\u6CA1\u6709\u5C01\u6740\u4EFB\u4F55\u7F51\u7AD9"):t("\u6CA1\u6709\u5339\u914D\u7684\u7F51\u7AD9")}description={entries.length===0?t("\u5728\u4E0A\u65B9\u8F93\u5165\u57DF\u540D\u5373\u53EF\u5F00\u59CB\uFF1B\u4E5F\u53EF\u4EE5\u5728\u6D4F\u89C8\u5668\u83DC\u5355\u4E2D\u9009\u62E9\u300C\u5C01\u6740\u6B64\u7F51\u7AD9\u300D\u3002"):t("\u6362\u4E2A\u5173\u952E\u8BCD\u8BD5\u8BD5\u3002")}/>
      : <div className="site-blacklist__list" role="list">
          <div className="site-blacklist__row site-blacklist__row--header" aria-hidden="true">
            <span>{t("\u7F51\u7AD9")}</span><span>{t("\u547D\u4E2D")}</span><span>{t("\u6700\u8FD1\u547D\u4E2D")}</span><span>{t("\u72B6\u6001")}</span><span>{t("\u64CD\u4F5C")}</span>
          </div>
          {filtered.map(entry => <div className="site-blacklist__row" role="listitem" key={entry.id}>
            <span className="site-blacklist__host" title={entry.note ?? entry.host}>
              <b>{entry.host}</b>
              <Button
                size="small"
                type={entry.includeSubdomains ? 'default' : 'primary'}
                disabled={!desktop}
                title={entry.includeSubdomains ?t("\u70B9\u51FB\u6539\u4E3A\u53EA\u5C01\u6740\u8BE5\u4E3B\u673A"):t("\u70B9\u51FB\u6539\u4E3A\u540C\u65F6\u5C01\u6740\u5B50\u57DF")}
                onClick={() => void toggleScope(entry)}
              >{entry.includeSubdomains ?t("\u542B\u5B50\u57DF"):t("\u4EC5\u672C\u7AD9")}</Button>
              {entry.source !== 'manual' && <Tag color="default">{entry.source === 'import' ?t("\u5BFC\u5165"):entry.source==='quick-block'?t("\u5FEB\u6377\u5C01\u6740"):entry.source}</Tag>}
            </span>
            <span>{entry.hitCount}</span>
            <span>{entry.lastBlockedAt ? new Date(entry.lastBlockedAt * 1000).toLocaleString() : '—'}</span>
            <span><Switch checked={entry.enabled} disabled={!desktop} onChange={value => void toggleEntry(entry, value)} /></span>
            <span>
              <Popconfirm
                title={t("\u89E3\u9664\u5C01\u6740 {value0}\uFF1F",{value0:entry.host})}
                description={t("\u89E3\u9664\u540E\u8BE5\u7F51\u7AD9\u53EF\u4EE5\u7ACB\u5373\u91CD\u65B0\u8BBF\u95EE\u3002")}
                okText={t("\u89E3\u9664")}
                cancelText={t("\u53D6\u6D88")}
                onConfirm={() => void removeEntry(entry)}
              >
                <Button size="small" danger>{t("\u89E3\u9664")}</Button>
              </Popconfirm>
            </span>
          </div>)}
        </div>}

    {events.length > 0 && <div className="site-blacklist__events">
      <Typography.Title level={5}>{t("\u6700\u8FD1\u547D\u4E2D")}</Typography.Title>
      <Typography.Paragraph type="secondary">{t("\u53EA\u8BB0\u5F55\u9876\u7EA7\u9875\u9762\u62E6\u622A\uFF0C\u79C1\u5BC6\u6807\u7B7E\u4E0D\u5199\u5165\u3002")}</Typography.Paragraph>
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
      title={t("\u6279\u91CF\u5BFC\u5165\u5C01\u6740\u540D\u5355")}
      okText={t("\u5F00\u59CB\u5BFC\u5165")}
      cancelText={t("\u5173\u95ED")}
      okButtonProps={{ disabled: !desktop || busy || !importText.trim() }}
      onOk={() => void handleImport()}
      onCancel={() => setImportOpen(false)}
    >
      <Typography.Paragraph type="secondary">{t("\u6BCF\u884C\u4E00\u4E2A\u57DF\u540D\u6216\u7F51\u5740\uFF0C\u4E5F\u652F\u6301\u9017\u53F7\u3001\u5206\u53F7\u5206\u9694\u3002\u8DEF\u5F84\u4F1A\u88AB\u5FFD\u7565\uFF0C\u53EA\u4FDD\u7559\u4E3B\u673A\u540D\u3002")}</Typography.Paragraph>
      <Input.TextArea
        rows={8}
        value={importText}
        onChange={event => setImportText(event.target.value)}
        placeholder={'example.com\nhttps://ads.example.net/path\n*.tracking.example.org'}
      />
      {lastImport && <div className="site-blacklist__import-result">
        <Typography.Text>{t("\u65B0\u589E")} {lastImport.added.length} {t("\u4E2A\uFF0C\u91CD\u590D")} {lastImport.duplicates.length} {t("\u4E2A\uFF0C\u65E0\u6548")} {lastImport.invalid.length} {t("\u4E2A")}</Typography.Text>
        {lastImport.invalid.length > 0 && <ul>
          {lastImport.invalid.slice(0, 8).map(item => <li key={item.input}>{item.input}：{item.reason}</li>)}
        </ul>}
      </div>}
    </Modal>
  </div>
}