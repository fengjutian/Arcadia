import { t } from '../../i18n'
import { useMemo, useState } from 'react'
import { Alert, Button, Input, List, Modal, Progress, Segmented, Space, Tag, Typography } from '../../components/ui'
import type { BulkProgressEntry } from './bulkSummary'
import { summaryKindLabelSafe } from './bulkSummary'
import type { SummaryKind } from './summarize'

export interface BulkSummaryPaletteProps {
  open: boolean
  onClose: () => void
  onRun: (urls: string[], kind: SummaryKind) => Promise<BulkProgressEntry[]>
  busy: boolean
  progress: BulkProgressEntry[]
}

const SUMMARY_KINDS: SummaryKind[] = ['one-sentence', 'short', 'detailed', 'key-points']

function parseUrls(raw: string): string[] {
  return raw.split(/\r?\n/).map(line => line.trim()).filter(line => /^https?:\/\//i.test(line))
}

export function BulkSummaryPalette({ open, onClose, onRun, busy, progress }: BulkSummaryPaletteProps) {
  const [raw, setRaw] = useState('')
  const [kind, setKind] = useState<SummaryKind>('short')
  const urls = useMemo(() => parseUrls(raw), [raw])
  const stats = useMemo(() => {
    let fetched = 0, summarised = 0, failed = 0, skipped = 0
    for (const entry of progress) {
      if (entry.status === 'fetched') fetched += 1
      else if (entry.status === 'summarised') summarised += 1
      else if (entry.status === 'failed') failed += 1
      else if (entry.status === 'skipped') skipped += 1
    }
    return { fetched, summarised, failed, skipped }
  }, [progress])
  const total = progress[progress.length - 1]?.total ?? urls.length
  const completed = progress.length
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100)
  const finished = total > 0 && completed >= total

  async function start() {
    if (!urls.length) return
    await onRun(urls, kind)
  }

  return <Modal
    open={open}
    onCancel={onClose}
    footer={null}
    width={680}
    destroyOnHidden
    title={null}
    styles={{ body: { padding: 0 } }}
  >
    <div className="bulk-summary-palette">
      <Typography.Title level={5} style={{ margin: '0 0 8px' }}>{t("\u591A\u94FE\u63A5 AI \u6458\u8981")}</Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>{t("\u6BCF\u884C\u4E00\u4E2A URL\uFF08\u4EC5 http/https\uFF09\u3002\u6BCF\u4E2A\u9875\u9762\u4F1A\u5355\u72EC\u8C03\u7528 AI \u6458\u8981\u5E76\u5B58\u4E3A\u6587\u6863\uFF0C\u6700\u540E\u518D\u628A\u6240\u6709\u6458\u8981\u5408\u5E76\u6210\u4E00\u4EFD\u7EFC\u8FF0\u3002")} 

      </Typography.Paragraph>
      <Space wrap style={{ marginBottom: 8 }}>
        <Segmented<SummaryKind>
          value={kind}
          onChange={value => setKind(value as SummaryKind)}
          options={SUMMARY_KINDS.map(          (option                                                )=>({label:summaryKindLabelSafe(option),value:option}))}
        />
        <Typography.Text type="secondary">{t("\u8BC6\u522B\u5230")} {urls.length} {t("\u4E2A URL")}</Typography.Text>
      </Space>
      <Input.TextArea
        value={raw}
        onChange={event => setRaw(event.target.value)}
        placeholder={'https://example.com/article-1\nhttps://example.com/article-2'}
        autoSize={{ minRows: 5, maxRows: 10 }}
        spellCheck={false}
      />
      <Space style={{ marginTop: 12 }}>
        <Button type="primary" loading={busy} disabled={!urls.length || finished} onClick={start}>{t("\u5F00\u59CB AI \u6458\u8981")}</Button>
        <Button onClick={onClose} disabled={busy}>{t("\u5173\u95ED")}</Button>
      </Space>
      {(busy || progress.length > 0) && <>
        <Progress percent={percent} status={finished ?( stats.failed > 0 ? 'exception' : 'success') : 'active'} style={{ marginTop: 16 }} />
        <Typography.Text type="secondary">{t("\u5B8C\u6210")} {completed} / {total} {t("\xB7 \u6458\u8981")} {stats.summarised} {t("\xB7 \u8DF3\u8FC7")} {stats.skipped} {t("\xB7 \u5931\u8D25")} {stats.failed}</Typography.Text>
        {progress.length > 0 && <List
          size="small"
          style={{ marginTop: 12, maxHeight: 220, overflow: 'auto' }}
          dataSource={progress}
          renderItem={(entry) => <List.Item>
            <List.Item.Meta
              title={<>
                <Typography.Text>{entry.title || entry.url}</Typography.Text>
                {entry.status === 'summarised' && <Tag color="green" style={{ marginLeft: 6 }}>{t("\u5DF2\u5B58\u5165")}</Tag>}
                {entry.status === 'skipped' && <Tag color="orange" style={{ marginLeft: 6 }}>{t("\u8DF3\u8FC7")}</Tag>}
                {entry.status === 'failed' && <Tag color="red" style={{ marginLeft: 6 }}>{t("\u5931\u8D25")}</Tag>}
              </>}
              description={<>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>{entry.url}</Typography.Text>
                {entry.message && <Alert type="warning" showIcon message={entry.message} style={{ marginTop: 4 }} />}
              </>}
            />
          </List.Item>}
        />}
      </>}
    </div>
  </Modal>
}