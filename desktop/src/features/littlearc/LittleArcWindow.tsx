import { t } from '../../i18n'
import { useEffect, useRef, useState } from 'react'
import { Button, Input, Select, Space, Typography } from '../../components/ui'
import { listCollections, type Collection } from '../../api'
import {
  closeLittleArc,
  listenLittleArcOpen,
  listenLittleArcResult,
  isSensitiveHost,
  readLittleArcPayload,
  requestLittleArcCapture,
  requestOpenInMain,
} from './littleArc'

type Status = 'idle' | 'pending' | 'saved' | 'error'

/** Small capture window rendered at `/?window=little-arc`. */
export function LittleArcWindow() {
  const [url, setUrl] = useState(() => readLittleArcPayload()?.url ?? '')
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')
  const [savedTitle, setSavedTitle] = useState('')
  const [collections, setCollections] = useState<Collection[]>([])
  const [targetCollection, setTargetCollection] = useState('')
  const requestRef = useRef<string | null>(null)

  useEffect(() => {
    void listCollections().then(setCollections).catch(() => setCollections([]))
  }, [])

  useEffect(() => {
    let disposed = false
    let unlistenOpen: (() => void) | undefined
    void listenLittleArcOpen(next => { if (next) { setUrl(next); setStatus('idle'); setError('') } }).then(stop => { if (disposed) stop(); else unlistenOpen = stop })
    return () => { disposed = true; unlistenOpen?.() }
  }, [])

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    // The result event carries the request id; ignore stale results.
    void listenLittleArcResult(result => {
      if (disposed || result.requestId !== requestRef.current) return
      if (result.ok) { setStatus('saved'); setSavedTitle(result.title ?? '') }
      else { setStatus('error'); setError(result.error ?? t("保存失败")) }
    }).then(stop => { if (disposed) stop(); else unlisten = stop })
    return () => { disposed = true; unlisten?.() }
  }, [])

  async function capture() {
    const trimmed = url.trim()
    if (!/^https?:\/\//i.test(trimmed)) {
      setStatus('error')
      setError(t("请输入有效的网址"))
      return
    }
    const requestId = crypto.randomUUID()
    requestRef.current = requestId
    setStatus('pending')
    setError('')
    try {
      await requestLittleArcCapture({ url: trimmed, requestId, collectionId: targetCollection || undefined })
    } catch (caught) {
      setStatus('error')
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  async function openInMain() {
    if (url.trim()) await requestOpenInMain(url.trim()).catch(() => undefined)
    await closeLittleArc().catch(() => undefined)
  }

  return <div className="little-arc">
    <div className="little-arc__head">
      <b>{t("随手收")}</b>
      <Button size="small" type="text" onClick={() => void closeLittleArc()}>{t("关闭")}</Button>
    </div>
    <Input
      autoFocus
      value={url}
      placeholder={t("粘贴链接，回车保存")}
      onChange={event => { setUrl(event.target.value); setStatus('idle'); setError('') }}
      onPressEnter={() => void capture()}
    />
    {status === 'saved' && <Typography.Text type="success">{t("已保存：{value0}", { value0: savedTitle || url })}</Typography.Text>}
    {status === 'error' && <Typography.Text type="danger">{error}</Typography.Text>}
    {isSensitiveHost(url) && <Typography.Text type="warning">{t("该站点可能包含账户或支付信息，确认后再保存。")}</Typography.Text>}
    {status === 'pending' && <Typography.Text type="secondary">{t("正在提取正文并保存\u2026")}</Typography.Text>}
    <Select
      size="small"
      value={targetCollection || 'none'}
      ariaLabel={t("目标集合")}
      options={[{ value: 'none', label: t("不指定（使用站点规则）") }, ...collections.map(collection => ({ value: collection.id, label: collection.name }))]}
      onChange={value => setTargetCollection(value === 'none' ? '' : String(value))}
    />
    <Space>
      <Button type="primary" size="small" loading={status === 'pending'} onClick={() => void capture()}>{t("保存到知识库")}</Button>
      <Button size="small" onClick={() => void openInMain()}>{t("在主窗口打开")}</Button>
    </Space>
    <Typography.Text type="secondary" className="little-arc__hint">{t("不影响当前标签：保存完成后小窗自动保留，可继续收下一条。")}</Typography.Text>
  </div>
}
