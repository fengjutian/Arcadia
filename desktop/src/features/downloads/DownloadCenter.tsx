import { t } from '../../i18n'
import { useMemo, useState } from 'react'
import { Button, Empty, List, Popconfirm, Progress, Space, Table, Tag, Tooltip, Typography, type TableColumn } from '../../components/ui'
import { CheckCircleOutlined, CloseCircleOutlined, DeleteOutlined, DownloadOutlined, ExclamationCircleOutlined, FileOutlined, FolderOpenOutlined, LoadingOutlined, MinusCircleOutlined, PauseOutlined, ReloadOutlined, StopOutlined } from '../../components/ui/icons'
import type { DownloadRecord } from '../../services/downloads'
import { fileNameOf } from '../../services/downloads'
import type { UseDownloadCenterResult } from './useDownloadCenter'

export interface DownloadCenterProps {
  center: UseDownloadCenterResult
  /** Optional upper bound; default 200 (Library tab default). */
  limit?: number
}

const STATUS_LABEL: Record<DownloadRecord['status'], string> = {
  queued:t("\u7B49\u5F85\u4E2D"),
  downloading:t("\u4E0B\u8F7D\u4E2D"),
  paused:t("\u5DF2\u6682\u505C"),
  completed:t("\u5DF2\u5B8C\u6210"),
  cancelled:t("\u5DF2\u53D6\u6D88"),
  failed:t("\u5931\u8D25"),
  blocked:t("\u5DF2\u62E6\u622A"),
}

const DANGER_LABEL: Record<DownloadRecord['dangerType'], string> = {
  none:t("\u5B89\u5168"),
  executable:t("\u53EF\u6267\u884C"),
  script:t("\u811A\u672C"),
  archive:t("\u538B\u7F29\u5305"),
  document:t("\u6587\u6863"),
  other:t("\u5176\u4ED6"),
}

const DANGER_COLOR: Record<DownloadRecord['dangerType'], string> = {
  none: 'green',
  executable: 'red',
  script: 'volcano',
  archive: 'blue',
  document: 'geekblue',
  other: 'default',
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${         (bytes/(1024*1024)).toFixed(1)} MB`
  return `${         (bytes/(1024*1024*1024)).toFixed(2)} GB`
}

function formatRelative(iso: string): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return iso
  const diff = Math.max(0, Date.now() - then)
  if (diff < 60_000) return t("{value0} \u79D2\u524D",{value0:Math.round(diff/1000)})
  if (diff < 3_600_000) return t("{value0} \u5206\u949F\u524D",{value0:Math.round(diff/60_000)})
  if (diff < 86_400_000) return t("{value0} \u5C0F\u65F6\u524D",{value0:Math.round(diff/3_600_000)})
  return t("{value0} \u5929\u524D",{value0:Math.round(diff/86_400_000)})
}

function statusIcon(status: DownloadRecord['status']) {
  switch (status) {
    case 'completed': return <CheckCircleOutlined className="is-success" />
    case 'failed': return <CloseCircleOutlined className="is-error" />
    case 'cancelled': return <MinusCircleOutlined />
    case 'blocked': return <ExclamationCircleOutlined className="is-error" />
    case 'downloading': return <LoadingOutlined spin />
    default: return <FileOutlined />
  }
}

function isTerminal(status: DownloadRecord['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'blocked'
}

/**
 * Full download history panel. Used by the Library page's "下载" tab. The
 * toolbar popover renders its own narrower view via {@link DownloadSummary}.
 */
export function DownloadCenter({ center, limit = 200 }: DownloadCenterProps) {
  const { records, hydrated, remove, open, reveal, pause, resume, cancel, retry } = center
  const filtered = useMemo(() => records.slice(0, limit), [records, limit])
  const [busyId, setBusyId] = useState<string | null>(null)

  if (!hydrated) {
    return <Typography.Text type="secondary">{t("\u52A0\u8F7D\u4E2D\u2026")}</Typography.Text>
  }

  if (filtered.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("\u8FD8\u6CA1\u6709\u4E0B\u8F7D\u8BB0\u5F55")}/>
  }

  const columns = [
    {
      title:t("\u6587\u4EF6"),
      dataIndex: 'fileName',
      key: 'fileName',
      render: (_, record) =>(
        <Space orientation="vertical" size={0}>
          <Typography.Text strong ellipsis={{ tooltip: fileNameOf(record) }} style={{ maxWidth: 320 }}>
            {fileNameOf(record)}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {record.sourceOrigin ?? record.url}
          </Typography.Text>
        </Space>)
       ,
    },
    {
      title:t("\u72B6\u6001"),
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (_, record) =>(
        <Space size={6}>
          {statusIcon(record.status)}
          <span>{STATUS_LABEL[record.status]}</span>
        </Space>)
       ,
    },
    {
      title:t("\u8FDB\u5EA6"),
      key: 'progress',
      width: 180,
      render: (_, record) => {
        if (record.status === 'completed') {
          return <Typography.Text type="success">{formatBytes(record.totalBytes ?? record.receivedBytes)}</Typography.Text>
        }
        if (record.status === 'downloading' || record.status === 'paused' || record.status === 'queued') {
          const total = record.totalBytes ?? 0
          const percent = total > 0 ? Math.min(100, Math.round((record.receivedBytes / total) * 100)) : 0
          return(
            <Progress
              percent={total > 0 ? percent : 100}
              status={record.status === 'paused' ? 'normal' : 'active'}
              format={() => total > 0 ? `${percent}%` :t("\u4E0D\u786E\u5B9A")}
              size="small"
            />)

        }
        if (record.errorMessage) {
          return <Tooltip title={record.errorMessage}><Typography.Text type="danger">{record.errorMessage}</Typography.Text></Tooltip>
        }
        return <Typography.Text type="secondary">—</Typography.Text>
      },
    },
    {
      title:t("\u5927\u5C0F"),
      key: 'size',
      width: 130,
      render: (_, record) =>(
        <Typography.Text type="secondary">
          {formatBytes(record.receivedBytes)} / {formatBytes(record.totalBytes)}
        </Typography.Text>)
       ,
    },
    {
      title:t("\u98CE\u9669"),
      dataIndex: 'dangerType',
      key: 'danger',
      width: 90,
      render: (_, record) => record.dangerType === 'none'
        ? <Typography.Text type="secondary">—</Typography.Text>
        : <Tag color={DANGER_COLOR[record.dangerType]}>{DANGER_LABEL[record.dangerType]}</Tag>,
    },
    {
      title:t("\u66F4\u65B0\u65F6\u95F4"),
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 110,
      render: (_, record) => <Typography.Text type="secondary">{formatRelative(record.updatedAt)}</Typography.Text>,
    },
    {
      title:t("\u64CD\u4F5C"),
      key: 'actions',
      width: 170,
      render: (_, record) =>(
        <Space size={4}>
          <Tooltip title={t("\u6253\u5F00\u6587\u4EF6")}>
            <Button
              size="small"
              type="text"
              icon={<FileOutlined />}
              disabled={!isTerminal(record.status) || record.status === 'cancelled' || !record.targetPath}
              loading={busyId === record.id}
              onClick={async () => { setBusyId(record.id); try { await open(record.id) } finally { setBusyId(null) } }}
            />
          </Tooltip>
          <Tooltip title={t("\u6253\u5F00\u6240\u5728\u6587\u4EF6\u5939")}>
            <Button
              size="small"
              type="text"
              icon={<FolderOpenOutlined />}
              disabled={!record.targetPath}
              loading={busyId === record.id}
              onClick={async () => { setBusyId(record.id); try { await reveal(record.id) } finally { setBusyId(null) } }}
            />
          </Tooltip>
          {record.status === 'downloading' &&(
            <Tooltip title={t("\u6682\u505C\uFF08\u4FDD\u7559\u5DF2\u4E0B\u8F7D\u7684\u90E8\u5206\uFF09")}>
              <Button
                size="small"
                type="text"
                icon={<PauseOutlined />}
                loading={busyId === record.id}
                onClick={async () => { setBusyId(record.id); try { await pause(record.id) } finally { setBusyId(null) } }}
              />
            </Tooltip>)
           }
          {record.status === 'paused' &&(
            <Tooltip title={t("\u7EE7\u7EED\u4E0B\u8F7D\uFF08\u4FDD\u7559\u5DF2\u4E0B\u8F7D\u7684\u90E8\u5206\uFF09")}>
              <Button
                size="small"
                type="text"
                icon={<DownloadOutlined />}
                loading={busyId === record.id}
                onClick={async () => { setBusyId(record.id); try { await resume(record.id) } finally { setBusyId(null) } }}
              />
            </Tooltip>)
           }
          {(record.status === 'downloading' || record.status === 'paused' || record.status === 'queued') &&(
            <Tooltip title={t("\u53D6\u6D88\u4E0B\u8F7D")}>
              <Button
                size="small"
                type="text"
                danger
                icon={<StopOutlined />}
                loading={busyId === record.id}
                onClick={async () => { setBusyId(record.id); try { await cancel(record.id) } finally { setBusyId(null) } }}
              />
            </Tooltip>)
           }
          {(record.status === 'failed' || record.status === 'cancelled' || record.status === 'blocked') &&(
            <Tooltip title={t("\u91CD\u8BD5")}>
              <Button
                size="small"
                type="text"
                icon={<ReloadOutlined />}
                loading={busyId === record.id}
                onClick={async () => { setBusyId(record.id); try { await retry(record.id) } finally { setBusyId(null) } }}
              />
            </Tooltip>)
           }
          <Popconfirm
            title={t("\u79FB\u9664\u8FD9\u6761\u8BB0\u5F55\uFF1F")}
            description={t("\u53EF\u540C\u65F6\u5220\u9664\u78C1\u76D8\u4E0A\u7684\u6587\u4EF6")}
            okText={t("\u4EC5\u79FB\u9664\u8BB0\u5F55")}
            cancelText={t("\u53D6\u6D88")}
            onConfirm={async () => { setBusyId(record.id); try { await remove(record.id, false) } finally { setBusyId(null) } }}
          >
            <Button size="small" type="text" icon={<DeleteOutlined />} />
          </Popconfirm>
          <Popconfirm
            title={t("\u5220\u9664\u4E0B\u8F7D\u6587\u4EF6\uFF1F")}
            description={t("\u4F1A\u540C\u65F6\u5220\u9664\u78C1\u76D8\u6587\u4EF6\uFF0C\u4E0D\u53EF\u64A4\u9500")}
            okText={t("\u5220\u9664\u6587\u4EF6")}
            okButtonProps={{ danger: true }}
            cancelText={t("\u53D6\u6D88")}
            disabled={!record.targetPath}
            onConfirm={async () => { setBusyId(record.id); try { await remove(record.id, true) } finally { setBusyId(null) } }}
          >
            <Button size="small" type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>)
       ,
    },
  ] satisfies TableColumn<DownloadRecord>[]

  return(
    <Table<DownloadRecord>
      rowKey="id"
      dataSource={filtered}
      columns={columns}
      size="small"
      pagination={{ pageSize: 20, showSizeChanger: false }}
      rowClassName={record => record.private ? 'download-row download-row--private' : 'download-row'}
    />)

}

/**
 * Lightweight toolbar popover: top-N live entries plus a "more" link that
 * jumps to the Library "下载" tab. Always shows the badge count of in-flight
 * downloads even when the popover is closed.
 */
export function DownloadSummary({
  feed,
  inFlight,
  pendingCount = 0,
  maxConcurrent,
}: {
  feed: UseDownloadCenterResult['feed']
  inFlight: number
  pendingCount?: number
  maxConcurrent?: number
}) {
  const items = feed.slice(0, 5)
  const subtitle = inFlight > 0
    ?t("{value0} \u4E2A\u6B63\u5728\u4E0B\u8F7D{value1}{value2}",{value0:inFlight,value1:maxConcurrent?t(" / \u4E0A\u9650 {value0}",{value0:maxConcurrent}):'',value2:pendingCount>0?t(" \xB7 {value0} \u6392\u961F\u4E2D",{value0:pendingCount}):''}):
      pendingCount > 0
      ?t("{value0} \u6392\u961F\u4E2D{value1}",{value0:pendingCount,value1:maxConcurrent?t(" / \u4E0A\u9650 {value0}",{value0:maxConcurrent}):''}):t("\u6682\u65E0\u6D3B\u52A8")

  return(
    <div className="browser-downloads">
      <div className="browser-downloads__head">
        <b>{t("\u4E0B\u8F7D")}</b>
        <Typography.Text type="secondary">{subtitle}</Typography.Text>
      </div>
      {items.length === 0
        ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("\u6682\u65E0\u4E0B\u8F7D")}/>
        :(
          <List
            size="small"
            dataSource={items}
            renderItem={item => {
              const name = fileNameOf(item)
              return(
                <List.Item>
                  <List.Item.Meta
                    avatar={statusIcon(item.status as DownloadRecord['status'])}
                    title={<Typography.Text ellipsis={{ tooltip: name }}>{name}</Typography.Text>}
                    description={
                      <Typography.Text type="secondary">
                        {STATUS_LABEL[item.status as DownloadRecord['status']] ?? item.status}
                        {item.totalBytes ? ` · ${formatBytes(item.receivedBytes)} / ${formatBytes(item.totalBytes)}` : ''}
                      </Typography.Text>
                    }
                  />
                </List.Item>)

            }}
          />)
         }
    </div>)

}